import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IPty } from 'node-pty'
import { escapeCwdToProjectDir, PtySession } from '../src/executor/pty/ptySession.js'
import type { PtyModule, PtySessionOptions, PtySpawnOptions } from '../src/executor/pty/ptySession.js'
import { JsonlWatcher } from '../src/executor/pty/screenWatcher.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await sleep(10)
  }
}

/** A fake node-pty IPty that records writes and can emit data/exit events. */
function createMockPty() {
  const writes: string[] = []
  const dataHandlers: Array<(data: string) => void> = []
  const exitHandlers: Array<(info: { exitCode: number; signal?: number }) => void> = []
  const mock = {
    pid: 4242,
    killed: false,
    writes,
    emitData: (data: string) => {
      for (const h of [...dataHandlers]) h(data)
    },
    emitExit: (info: { exitCode: number; signal?: number }) => {
      for (const h of [...exitHandlers]) h(info)
    },
    write: (data: string) => {
      writes.push(data)
    },
    kill: () => {
      mock.killed = true
    },
    onData: (handler: (data: string) => void) => {
      dataHandlers.push(handler)
      return { dispose() {} }
    },
    onExit: (handler: (info: { exitCode: number; signal?: number }) => void) => {
      exitHandlers.push(handler)
      return { dispose() {} }
    },
    resize: () => {},
    pause: () => {},
    resume: () => {},
    clear: () => {},
    process: 'claude',
  }
  return mock
}

/** Fast test tuning: no settle delays, no keystroke pacing. */
const FAST_TUNING = {
  readySettleMs: 0,
  idlePollMs: 10,
  idleStableMs: 0,
  typeDelayMs: 0,
  submitDelayMs: 0,
}

function makeSession(
  opts: Partial<PtySessionOptions> & { cwd: string },
  claudeConfigPath: string,
  mock: ReturnType<typeof createMockPty>,
) {
  const { tuning, ...rest } = opts
  const ptyModule: PtyModule = {
    spawn: (_file: string, _args: string[], _options: PtySpawnOptions) =>
      mock as unknown as IPty,
  }
  const session = new PtySession({
    claudeConfigPath,
    ptyModule,
    tuning: { ...FAST_TUNING, ...(tuning ?? {}) },
    ...rest,
  } as PtySessionOptions)
  return { session, mock }
}

// ---------------------------------------------------------------------------
// escapeCwdToProjectDir
// ---------------------------------------------------------------------------

test('escapeCwdToProjectDir maps a Windows backslash cwd to dashed form', () => {
  assert.equal(escapeCwdToProjectDir('D:\\Codes\\voxcode'), 'D--Codes-voxcode')
})

test('escapeCwdToProjectDir maps a unix forward-slash cwd to dashed form', () => {
  assert.equal(escapeCwdToProjectDir('/a/b'), '-a-b')
})

test('escapeCwdToProjectDir handles mixed separators', () => {
  assert.equal(escapeCwdToProjectDir('C:/Users/x'), 'C--Users-x')
})

test('escapeCwdToProjectDir handles trailing separators', () => {
  assert.equal(escapeCwdToProjectDir('/a/b/'), '-a-b-')
})

test('escapeCwdToProjectDir keeps empty input empty', () => {
  assert.equal(escapeCwdToProjectDir(''), '')
})

// ---------------------------------------------------------------------------
// Session id / jsonlPath
// ---------------------------------------------------------------------------

test('sessionId reuses the resume id', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession({ cwd: tempDir, resume: 'sess-resume-1' }, join(tempDir, 'cfg.json'), mock)
    assert.equal(session.sessionId, 'sess-resume-1')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('sessionId is a fresh UUID when no resume is given', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession({ cwd: tempDir }, join(tempDir, 'cfg.json'), mock)
    assert.match(session.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.ok(session.jsonlPath.endsWith(`${session.sessionId}.jsonl`))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('jsonlPath is computed under ~/.claude/projects/<escaped-cwd>', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const cwd = join(tempDir, 'my project')
    const mock = createMockPty()
    const { session } = makeSession({ cwd, resume: 'jsonl-1' }, join(tempDir, 'cfg.json'), mock)
    const expected = join(
      homedir(),
      '.claude',
      'projects',
      escapeCwdToProjectDir(cwd),
      'jsonl-1.jsonl',
    )
    assert.equal(session.jsonlPath, expected)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('jsonlPath escapes a Windows drive path into the project dir (win32)', async () => {
  if (process.platform !== 'win32') return // windows-specific case-assertion
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const cwd = 'D:\\Codes\\voxcode' // fixed absolute win32 cwd
    const mock = createMockPty()
    const { session } = makeSession({ cwd, resume: 'win-1' }, join(tempDir, 'cfg.json'), mock)
    assert.ok(session.jsonlPath.includes('projects\\D--Codes-voxcode\\win-1.jsonl'))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Spawn / args
// ---------------------------------------------------------------------------

test('spawn passes resume, settings and skip-permissions args', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const captured: { call: { file: string; args: string[]; options: PtySpawnOptions } | null } = {
      call: null,
    }
    const mock = createMockPty()
    const ptyModule: PtyModule = {
      spawn: (file, args, options) => {
        captured.call = { file, args, options }
        return mock as unknown as IPty
      },
    }
    new PtySession({
      cwd: tempDir,
      resume: 'abc-123',
      settingsPath: '/tmp/settings.json',
      model: 'm1',
      appendSystemPrompt: 'extra',
      pathToClaudeExecutable: '/opt/bin/claude',
      claudeConfigPath: join(tempDir, 'cfg.json'),
      ptyModule,
      tuning: FAST_TUNING,
    })

    assert.ok(captured.call, 'spawn must be called')
    assert.equal(captured.call.file, '/opt/bin/claude')
    assert.deepEqual(captured.call.args, [
      '--resume',
      'abc-123',
      '--settings',
      '/tmp/settings.json',
      '--dangerously-skip-permissions',
      '--append-system-prompt',
      'extra',
      '--model',
      'm1',
    ])
    assert.equal(captured.call.options.env?.['CLAUDE_CODE_ENTRYPOINT'], undefined)
    assert.equal(captured.call.options.cwd, tempDir)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('spawn uses --session-id when no resume is given', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const captured: { call: { args: string[] } | null } = { call: null }
    const mock = createMockPty()
    const ptyModule: PtyModule = {
      spawn: (_file, args, _options) => {
        captured.call = { args }
        return mock as unknown as IPty
      },
    }
    const session = new PtySession({
      cwd: tempDir,
      claudeConfigPath: join(tempDir, 'cfg.json'),
      ptyModule,
      tuning: FAST_TUNING,
    })
    assert.ok(captured.call)
    assert.equal(captured.call.args[0], '--session-id')
    assert.equal(captured.call.args[1], session.sessionId)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Folder trust pre-acceptance
// ---------------------------------------------------------------------------

test('ensureFolderTrusted seeds hasTrustDialogAccepted for the cwd', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const cfgPath = join(tempDir, 'claude.json')
    const mock = createMockPty()
    const cwd = 'D:\\trusted\\project'
    makeSession({ cwd }, cfgPath, mock)

    const cfg = JSON.parse(await readFile(cfgPath, 'utf-8'))
    assert.equal(cfg.projects[cwd].hasTrustDialogAccepted, true)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('ensureFolderTrusted preserves an existing config file', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const cfgPath = join(tempDir, 'claude.json')
    await writeFile(cfgPath, JSON.stringify({ oauthAccount: { name: 'me' } }), 'utf-8')
    const mock = createMockPty()
    makeSession({ cwd: '/proj' }, cfgPath, mock)

    const cfg = JSON.parse(await readFile(cfgPath, 'utf-8'))
    assert.equal(cfg.oauthAccount.name, 'me')
    assert.equal(cfg.projects['/proj'].hasTrustDialogAccepted, true)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Readiness / input / snapshot
// ---------------------------------------------------------------------------

test('ready() resolves once the TUI input box hint (❯) appears', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession({ cwd: tempDir }, join(tempDir, 'cfg.json'), mock)

    mock.emitData('claude 2.x\nalready authenticated\n❯ ')
    await session.ready() // must resolve, not reject
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('ready() rejects on timeout when the TUI never shows an input box', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession(
      { cwd: tempDir, tuning: { readyTimeoutMs: 40, readyPollMs: 10 } },
      join(tempDir, 'cfg.json'),
      mock,
    )
    await assert.rejects(() => session.ready(), /timeout.*waiting for TUI input box/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('typePrompt sends the text then submits with double Enter', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession({ cwd: tempDir }, join(tempDir, 'cfg.json'), mock)

    mock.emitData('❯ ')
    await session.typePrompt('hello')
    assert.deepEqual(mock.writes, ['h', 'e', 'l', 'l', 'o', '\r', '\r'])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('typePrompt waits for idle input before typing while the model runs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession(
      { cwd: tempDir, tuning: { idleTimeoutMs: 500 } },
      join(tempDir, 'cfg.json'),
      mock,
    )

    // First the model is generating (footer shows "esc to interrupt").
    mock.emitData('❯ esc to interrupt')
    const typing = session.typePrompt('hey') // should hold back while running
    await sleep(80)
    assert.equal(mock.writes.length, 0, 'no keystrokes while the model runs')

    // The model finishes: fresh redraws scroll the old footer out of the
    // recent-output window and leave only the idle `❯` input box.
    mock.emitData('\n'.repeat(750) + '❯ ')
    await typing
    assert.deepEqual(mock.writes, ['h', 'e', 'y', '\r', '\r'])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('interrupt sends ESC then Ctrl-C', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession({ cwd: tempDir }, join(tempDir, 'cfg.json'), mock)
    await session.interrupt()
    assert.deepEqual(mock.writes, ['\x1b', '\x03'])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('sendKeys writes raw bytes without submit framing', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession({ cwd: tempDir }, join(tempDir, 'cfg.json'), mock)
    session.sendKeys('2\r')
    session.sendKeys('\x1b[B')
    assert.deepEqual(mock.writes, ['2\r', '\x1b[B'])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('snapshot strips ANSI escapes and control bytes', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession({ cwd: tempDir }, join(tempDir, 'cfg.json'), mock)

    mock.emitData('\x1b[2J\x1b[32mhello\x1b[0m\r\n')
    mock.emitData('\x1b]0;title\x07tail')

    const snap = session.snapshot()
    assert.ok(snap.includes('hello'))
    assert.ok(snap.includes('tail'))
    assert.ok(!snap.includes('\x1b'), 'no escape bytes remain')
    assert.equal(snap.includes('[2J'), false)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('screen returns the last rows of the stripped output', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession({ cwd: tempDir }, join(tempDir, 'cfg.json'), mock)

    mock.emitData('line1\nline2\nline3\nline4\nline5\n❯ ')
    const screen = session.screen()
    const lines = screen.split('\n')
    assert.equal(lines[lines.length - 1], '❯')
    assert.ok(screen.includes('line3'), 'older lines pruned to the tail window')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('dispose writes Ctrl-C, kills the pty, then allows no further writes', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const { session } = makeSession({ cwd: tempDir }, join(tempDir, 'cfg.json'), mock)
    await session.dispose()
    assert.ok(mock.killed, 'pty killed on dispose')
    session.sendKeys('ignored')
    assert.equal(mock.writes.includes('ignored'), false)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('onExit fires when the pty reports process exit', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-test-'))
  try {
    const mock = createMockPty()
    const exits: Array<{ exitCode: number; signal?: number }> = []
    const { session } = makeSession(
      { cwd: tempDir, onExit: (info) => exits.push(info) },
      join(tempDir, 'cfg.json'),
      mock,
    )
    assert.ok(session) // constructed
    mock.emitExit({ exitCode: 0 })
    await sleep(10)
    assert.deepEqual(exits, [{ exitCode: 0, signal: undefined }])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// JsonlWatcher
// ---------------------------------------------------------------------------

test('JsonlWatcher parses appended JSONL lines from a file', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-watch-'))
  const file = join(tempDir, 'session.jsonl')
  let watcher: JsonlWatcher | undefined
  try {
    await writeFile(file, '', 'utf-8')
    watcher = new JsonlWatcher({ pollMs: 10 })
    const seen: Array<Record<string, any>> = []
    watcher.start(file, (m) => seen.push(m as unknown as Record<string, any>))

    await appendFile(file, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }) + '\n', 'utf-8')
    await appendFile(file, JSON.stringify({ type: 'result', result: 'done' }) + '\n', 'utf-8')
    await waitFor(() => seen.length === 2)

    assert.deepEqual(seen[0].type, 'assistant')
    assert.deepEqual(seen[0].message.content[0].text, 'hi')
    assert.deepEqual(seen[1].type, 'result')
  } finally {
    watcher?.stop()
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('JsonlWatcher skips malformed lines and keeps parsing', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-watch-'))
  const file = join(tempDir, 'session.jsonl')
  let watcher: JsonlWatcher | undefined
  try {
    await writeFile(file, 'not-json\n', 'utf-8')
    watcher = new JsonlWatcher({ pollMs: 10 })
    const seen: Array<Record<string, any>> = []
    watcher.start(file, (m) => seen.push(m as unknown as Record<string, any>))

    await appendFile(file, JSON.stringify({ type: 'user' }) + '\n', 'utf-8')
    await appendFile(file, '{broken}\n', 'utf-8')
    await appendFile(file, JSON.stringify({ type: 'result' }) + '\n', 'utf-8')
    await waitFor(() => seen.length === 2)

    assert.deepEqual(seen.map((m) => m.type), ['user', 'result'])
  } finally {
    watcher?.stop()
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('JsonlWatcher buffers a partial trailing line until it is complete', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-watch-'))
  const file = join(tempDir, 'session.jsonl')
  let watcher: JsonlWatcher | undefined
  try {
    await writeFile(file, '', 'utf-8')
    watcher = new JsonlWatcher({ pollMs: 10 })
    const seen: Array<Record<string, any>> = []
    watcher.start(file, (m) => seen.push(m as unknown as Record<string, any>))

    const full = JSON.stringify({ type: 'partial' }) // {"type":"partial"}
    await appendFile(file, full.slice(0, -5), 'utf-8') // incomplete line
    await sleep(80)
    assert.equal(seen.length, 0, 'incomplete line must not be parsed')

    await appendFile(file, full.slice(-5) + '\n', 'utf-8') // finish the line
    await waitFor(() => seen.length === 1)
    assert.deepEqual(seen[0].type, 'partial')
  } finally {
    watcher?.stop()
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('JsonlWatcher waits for the file to appear before reading', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-watch-'))
  const file = join(tempDir, 'later.jsonl')
  let watcher: JsonlWatcher | undefined
  try {
    watcher = new JsonlWatcher({ pollMs: 10 })
    const seen: Array<Record<string, any>> = []
    watcher.start(file, (m) => seen.push(m as unknown as Record<string, any>))

    // File does not exist yet — no records.
    await sleep(60)
    assert.equal(seen.length, 0)

    await writeFile(file, JSON.stringify({ type: 'assistant' }) + '\n', 'utf-8')
    await waitFor(() => seen.length === 1)
    assert.deepEqual(seen[0].type, 'assistant')
  } finally {
    watcher?.stop()
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('JsonlWatcher stop() halts further emission', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'pty-watch-'))
  const file = join(tempDir, 'session.jsonl')
  let watcher: JsonlWatcher | undefined
  try {
    await writeFile(file, '', 'utf-8')
    watcher = new JsonlWatcher({ pollMs: 10 })
    const seen: Array<Record<string, any>> = []
    watcher.start(file, (m) => seen.push(m as unknown as Record<string, any>))

    await appendFile(file, JSON.stringify({ type: 'assistant' }) + '\n', 'utf-8')
    await waitFor(() => seen.length === 1)
    assert.equal(watcher.running, true)

    watcher.stop()
    assert.equal(watcher.running, false)
    await appendFile(file, JSON.stringify({ type: 'user' }) + '\n', 'utf-8')
    await sleep(80)
    assert.equal(seen.length, 1, 'no records after stop()')
  } finally {
    watcher?.stop()
    await rm(tempDir, { recursive: true, force: true })
  }
})