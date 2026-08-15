/**
 * PtySession — drives a REAL interactive `claude` TUI process via node-pty.
 *
 * Owns: process spawn, lifecycle, keystroke input, readiness detection
 * (waits for the `❯` input-box hint in the PTY output), and the session
 * jsonl path. Does NOT own: jsonl reading (see JsonlWatcher), message
 * adapting, hooks.
 *
 * Adapted from metabot's proven `pty-session.ts` driver.
 *
 * @module executor/pty/ptySession
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as nodePty from 'node-pty'
import type { IPty } from 'node-pty'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Max bytes kept in the PTY output ring buffer. */
const RING_CAP = 64 * 1024

/** Timing knobs for readiness / keystroke handling (also test seams). */
export interface PtyTuning {
  /** Poll interval while waiting for the `❯` input-box hint. */
  readyPollMs: number
  /** Overall timeout for boot readiness. */
  readyTimeoutMs: number
  /** Settle time after the input box is first detected. */
  readySettleMs: number
  /** Poll interval while waiting for an idle input box. */
  idlePollMs: number
  /** Overall timeout for the idle-input wait. */
  idleTimeoutMs: number
  /** How long the idle state must hold before typing. */
  idleStableMs: number
  /** Pause between typing the prompt and pressing Enter. */
  typeDelayMs: number
  /** Pause between the first and the double-Enter safeguard. */
  submitDelayMs: number
}

const DEFAULT_TUNING: PtyTuning = {
  readyPollMs: 150,
  readyTimeoutMs: 30_000,
  readySettleMs: 2_500,
  idlePollMs: 200,
  idleTimeoutMs: 15_000,
  idleStableMs: 700,
  typeDelayMs: 800,
  submitDelayMs: 1_500,
}

/** Minimal logger surface accepted by PtySession. */
export interface PtyLogger {
  debug?: (message: string) => void
  info?: (message: string) => void
  warn?: (message: string, error?: unknown) => void
  error?: (message: string, error?: unknown) => void
}

/** Spawn options we pass to the PTY backend. */
export interface PtySpawnOptions {
  name?: string
  cols?: number
  rows?: number
  cwd?: string
  env?: Record<string, string>
}

/** Minimal node-pty surface used by PtySession (injectable for tests). */
export interface PtyModule {
  spawn(file: string, args: string[], options: PtySpawnOptions): IPty
}

/** Process-exit information delivered to the onExit callback. */
export interface PtyExitInfo {
  exitCode: number
  signal?: number
}

/** Options for creating a {@link PtySession}. */
export interface PtySessionOptions {
  /** Absolute working directory the interactive claude should run in. */
  cwd: string
  /** Existing session id to resume. */
  resume?: string
  /** Model override passed through as --model. */
  model?: string
  /** Settings file passed through as --settings. */
  settingsPath?: string
  /** Extra system prompt passed through as --append-system-prompt. */
  appendSystemPrompt?: string
  /** Initial PTY width in columns (default 120). */
  cols?: number
  /** Initial PTY height in rows (default 40). */
  rows?: number
  /** Path to the claude executable (default "claude"). */
  pathToClaudeExecutable?: string
  /** Extra environment variables for the child process. */
  env?: Record<string, string>
  /** Optional logger. */
  logger?: PtyLogger
  /** Called once the claude process exits. */
  onExit?: (info: PtyExitInfo) => void
  /**
   * Test seam: the PTY backend. Defaults to the real node-pty module so the
   * `spawn` is mocked in tests without ever creating a real PTY.
   */
  ptyModule?: PtyModule
  /**
   * Test seam: the path of ~/.claude.json used for folder-trust
   * pre-acceptance. Defaults to the real user config.
   */
  claudeConfigPath?: string
  /** Timing overrides for readiness / keystroke handling. */
  tuning?: Partial<PtyTuning>
}

/**
 * Derive the escaped project directory key exactly as claude itself does:
 * path separators and the win32 drive colon become dashes.
 * `D:\Codes\voxbridge` maps to `D--Codes-voxbridge`, `/a/b` maps to `-a-b`.
 */
export function escapeCwdToProjectDir(cwd: string): string {
  return cwd.replace(/[:\\/]/g, '-')
}

export class PtySession {
  /** Session id: adopted from `resume` or self-generated. */
  readonly sessionId: string
  /** Full path of the session jsonl file claude writes for this session. */
  readonly jsonlPath: string

  private term: IPty | null = null
  private ring = ''
  private readonly cols: number
  private readonly rows: number
  private readonly opts: PtySessionOptions
  private readonly tuning: PtyTuning
  private readonly ptyModule: PtyModule
  private readyPromise: Promise<void> | null = null
  private disposed = false

  constructor(opts: PtySessionOptions) {
    this.opts = opts
    this.tuning = { ...DEFAULT_TUNING, ...opts.tuning }
    this.cols = opts.cols ?? 120
    this.rows = opts.rows ?? 40
    this.ptyModule = opts.ptyModule ?? { spawn: nodePty.spawn }

    // Session id: adopt resume id or self-generate.
    this.sessionId = opts.resume ?? randomUUID()

    // Compute jsonl path: ~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl
    // cwd MUST be absolute here — resolve defensively so the path derivation
    // matches exactly what claude itself does (it derives its jsonl dir from
    // its own cwd). Backslashes and forward slashes both become dashes so the
    // escaped key is identical on win32 and posix.
    const resolvedCwd = path.resolve(opts.cwd)
    this.jsonlPath = path.join(
      os.homedir(),
      '.claude',
      'projects',
      escapeCwdToProjectDir(resolvedCwd),
      `${this.sessionId}.jsonl`,
    )

    this.spawn()
  }

  private get logger(): PtyLogger | undefined {
    return this.opts.logger
  }

  /**
   * Pre-accept the per-folder trust dialog for `cwd` in ~/.claude.json.
   *
   * On the FIRST interactive run in a directory, `claude` shows a blocking
   * "Is this a project you trust?" prompt — even under
   * --dangerously-skip-permissions. That dialog renders a `❯` menu pointer,
   * which fools the readiness detector: we then "type" the prompt into the
   * menu and the session is corrupted. Seeding
   * `projects[cwd].hasTrustDialogAccepted = true` (exactly how claude records
   * an accepted dialog) suppresses it entirely.
   *
   * Best-effort + targeted: we read-modify-write only the single nested flag
   * so we don't clobber the rest of the file. Failures are logged, not fatal.
   */
  private ensureFolderTrusted(cwd: string): void {
    const cfgPath = this.opts.claudeConfigPath ?? path.join(os.homedir(), '.claude.json')
    try {
      let cfg: Record<string, any> = {}
      try {
        cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
      } catch {
        // missing/empty/corrupt — start from an empty object
        cfg = {}
      }
      if (!cfg.projects || typeof cfg.projects !== 'object') cfg.projects = {}
      const entry =
        cfg.projects[cwd] && typeof cfg.projects[cwd] === 'object'
          ? cfg.projects[cwd]
          : (cfg.projects[cwd] = {})
      if (entry.hasTrustDialogAccepted === true) return // already trusted
      entry.hasTrustDialogAccepted = true
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
      this.logger?.info?.(`pty-session: pre-accepted folder trust in ${cfgPath}`)
    } catch (err) {
      this.logger?.warn?.(
        'pty-session: failed to pre-accept folder trust (may hit trust dialog)',
        err,
      )
    }
  }

  private spawn(): void {
    const { opts, tuning } = this
    this.ensureFolderTrusted(opts.cwd)

    const args: string[] = []
    if (opts.resume) {
      args.push('--resume', opts.resume)
    } else {
      args.push('--session-id', this.sessionId)
    }
    args.push(
      '--settings',
      opts.settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json'),
    )
    args.push('--dangerously-skip-permissions')
    if (opts.appendSystemPrompt) {
      args.push('--append-system-prompt', opts.appendSystemPrompt)
    }
    if (opts.model) {
      args.push('--model', opts.model)
    }

    // Build the child env: process.env + caller overrides.
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v
    }
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        if (v !== undefined) env[k] = v
      }
    }
    // A PTY session is INTERACTIVE by definition. Strip the SDK-entrypoint
    // markers so the spawned claude uses the interactive billing pool.
    for (const k of ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDECODE']) {
      delete env[k]
    }

    // Spawn with the SAME absolute cwd used to derive jsonlPath, so claude's
    // own jsonl-dir derivation matches ours.
    const spawnCwd = path.resolve(opts.cwd)
    this.logger?.debug?.(
      `pty-session: spawning claude (sessionId=${this.sessionId} cwd=${spawnCwd})`,
    )

    this.term = this.ptyModule.spawn(opts.pathToClaudeExecutable ?? 'claude', args, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: spawnCwd,
      env,
    })

    this.term.onData((data: string) => {
      this.ring += data
      if (this.ring.length > RING_CAP) {
        this.ring = this.ring.slice(-RING_CAP)
      }
    })

    this.term.onExit(({ exitCode, signal }) => {
      this.logger?.info?.(`pty-session: claude process exited (${exitCode})`)
      try {
        opts.onExit?.({ exitCode, signal })
      } catch (err) {
        this.logger?.warn?.('pty-session: onExit callback threw', err)
      }
    })
  }

  /** Resolves once the TUI is booted and sitting at an input box. */
  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.waitForReady()
    }
    return this.readyPromise
  }

  private async waitForReady(): Promise<void> {
    const { readyPollMs, readyTimeoutMs, readySettleMs } = this.tuning
    const start = Date.now()

    while (Date.now() - start < readyTimeoutMs) {
      if (/❯/.test(this.ring)) {
        this.logger?.info?.('pty-session: TUI input box detected, settling...')
        await sleep(readySettleMs)
        return
      }
      await sleep(readyPollMs)
    }

    throw new Error(
      `pty-session: timeout (${readyTimeoutMs}ms) waiting for TUI input box (❯). ` +
        `Last 500 chars: ${this.ring.slice(-500)}`,
    )
  }

  /**
   * Wait until the TUI is at an IDLE input box, ready to accept a new prompt.
   *
   * The snapshot is an append-log of PTY output (not a screen buffer), so we
   * read only the most-recent slice — the latest redraw — and key off what
   * claude actively rewrites there:
   *   - "esc to interrupt" in the live footer ⟶ the model is generating.
   *   - a menu footer ("enter to select", "ctrl-g to edit", "shift+tab to
   *     approve") or a `❯` pointing at a numbered option ⟶ a blocking menu is
   *     up (never type a prompt into it).
   *   - otherwise, with the `❯` input box present ⟶ idle and ready.
   * We require the idle state to hold across a couple polls so a single
   * mid-redraw frame doesn't trip us, and cap the wait so a missed heuristic
   * degrades to typing anyway rather than wedging the turn.
   */
  private async waitForIdleInput(): Promise<void> {
    const { idlePollMs, idleTimeoutMs, idleStableMs } = this.tuning
    const start = Date.now()
    let idleSince = 0

    while (Date.now() - start < idleTimeoutMs) {
      const tail = this.snapshot().slice(-700)
      const sq = tail.toLowerCase().replace(/\s+/g, '')
      const running = sq.includes('esctointerrupt')
      const menuUp =
        sq.includes('entertoselect') ||
        sq.includes('ctrl-gtoedit') ||
        sq.includes('shift+tabtoapprove') ||
        /❯\d\./.test(sq) // pointer on a numbered menu option
      const hasInputBox = tail.includes('❯')
      if (hasInputBox && !running && !menuUp) {
        if (!idleSince) idleSince = Date.now()
        if (Date.now() - idleSince >= idleStableMs) return
      } else {
        idleSince = 0
      }
      await sleep(idlePollMs)
    }
    this.logger?.warn?.('pty-session: idle-input wait timed out — typing anyway')
  }

  /** Type a prompt into the TUI and submit it with (double) Enter. */
  async typePrompt(text: string): Promise<void> {
    await this.ready() // boot: wait for the TUI to first come up
    // Per-call readiness: wait for the TUI to return to an idle input box
    // before typing (see waitForIdleInput).
    await this.waitForIdleInput()
    if (!this.term || this.disposed) {
      throw new Error('pty-session: cannot type — session disposed')
    }

    this.logger?.debug?.(`pty-session: typing prompt (${text.length} chars)`)

    // Type char-by-char into the PTY (interactive input).
    for (const ch of text) {
      this.term.write(ch)
    }

    await sleep(this.tuning.typeDelayMs)
    this.term.write('\r')
    await sleep(this.tuning.submitDelayMs)
    // Double-Enter safeguard: the TUI sometimes needs a second Enter to submit.
    this.term.write('\r')
  }

  /** Interrupt whatever claude is currently doing (ESC then Ctrl-C). */
  async interrupt(): Promise<void> {
    if (!this.term || this.disposed) return
    this.term.write('\x1b')
    await sleep(100)
    this.term.write('\x03')
    await sleep(100)
  }

  /**
   * Write raw bytes to the PTY without any prompt-submit framing. Used to
   * drive native TUI menus (digit selects, arrow keys, `\r` confirms). The
   * caller composes the exact key sequence.
   */
  sendKeys(data: string): void {
    if (!this.term || this.disposed) return
    this.term.write(data)
  }

  /**
   * Return an ANSI-stripped snapshot of the recent PTY output ring. Control
   * bytes and SGR/cursor/OSC escapes are removed so simple text regexes work.
   */
  snapshot(): string {
    /* eslint-disable no-control-regex -- stripping ANSI/control bytes from PTY output is intentional here */
    return this.ring
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\x1b[()][AB0]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    /* eslint-enable no-control-regex */
  }

  /**
   * Return a best-effort "current screen" — the last `rows` text lines of the
   * ANSI-stripped output, reconstructed from the append-log. This is a
   * lightweight heuristic (no full terminal emulator); for exact row/grid
   * parsing a headless VT can be layered on top of the same ring later.
   */
  screen(): string {
    const lines = this.snapshot().split('\n')
    return lines
      .slice(-this.rows)
      .join('\n')
      .replace(/\s+$/, '')
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (!this.term) return

    this.term.write('\x03')
    await sleep(300)
    this.term.kill()
    this.term = null
  }
}