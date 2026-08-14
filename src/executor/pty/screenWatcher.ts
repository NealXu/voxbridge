/**
 * JsonlWatcher — tails a Claude session `.jsonl` file and emits each newly
 * appended JSON record exactly once, via a callback. Handles:
 *   - file not yet existing (polls until it appears)
 *   - file recreate/truncation (offset resets)
 *   - partial trailing line (buffered until newline-terminated)
 *   - malformed lines (skipped, polling continues)
 *   - clean stop via stop()
 *
 * Uses byte-offset tracking + interval polling (fs.read from last offset),
 * the same proven approach as metabot's jsonl scanner.
 *
 * @module executor/pty/screenWatcher
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import type { SDKMessage } from '../types.js'

/** Callback invoked once per newly parsed JSONL record. */
export type JsonlOnLine = (message: SDKMessage) => void

/** Options for creating a {@link JsonlWatcher}. */
export interface JsonlWatcherOptions {
  /** Poll interval in ms (default 120). */
  pollMs?: number
  /**
   * When the file is first seen and after each recreate, read from the end
   * instead of the beginning (default false).
   */
  startAtEnd?: boolean
  /** Called when a filesystem read fails (non-fatal, polling continues). */
  onError?: (err: unknown) => void
}

export class JsonlWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private offset = 0
  private partialLine = ''
  private onLine: JsonlOnLine | null = null
  private onErrorCb: ((err: unknown) => void) | undefined
  private filePath = ''
  private readonly pollMs: number
  private readonly startAtEnd: boolean

  constructor(options: JsonlWatcherOptions = {}) {
    this.pollMs = options.pollMs ?? 120
    this.startAtEnd = options.startAtEnd ?? false
    this.onErrorCb = options.onError
  }

  /** Whether the watcher is currently polling. */
  get running(): boolean {
    return this.timer !== null
  }

  /**
   * Begin tailing `filePath`, calling `onLine` for each parsed record.
   *
   * If the file does not exist yet the watcher polls until it appears. A
   * second start() while running is a no-op.
   */
  start(filePath: string, onLine: JsonlOnLine): void {
    if (this.timer) return
    this.filePath = filePath
    this.onLine = onLine
    this.offset = 0
    this.partialLine = ''
    this.poll() // immediate first read
    this.timer = setInterval(() => this.poll(), this.pollMs)
    this.timer.unref?.()
  }

  /** Stop tailing. Safe to call when not running. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.onLine = null
    this.offset = 0
    this.partialLine = ''
  }

  private fileSize(): number {
    try {
      return statSync(this.filePath).size
    } catch {
      return 0
    }
  }

  private poll(): void {
    const onLine = this.onLine
    if (!onLine) return

    const size = this.fileSize()
    if (size < this.offset) {
      // File was recreated/truncated — start over from the boundary.
      this.offset = this.startAtEnd ? size : 0
      this.partialLine = ''
    }
    if (size <= this.offset) return

    const bytesToRead = size - this.offset
    const buf = Buffer.alloc(bytesToRead)

    let fd: number | undefined
    try {
      fd = openSync(this.filePath, 'r')
      readSync(fd, buf, 0, bytesToRead, this.offset)
    } catch (err) {
      this.onErrorCb?.(err)
      return
    } finally {
      if (fd !== undefined) closeSync(fd)
    }

    this.offset = size
    const chunk = buf.toString('utf8')
    const raw = this.partialLine + chunk
    const lines = raw.split('\n')

    // Last element is either '' (chunk ended with \n) or an incomplete line.
    this.partialLine = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        onLine(JSON.parse(trimmed) as SDKMessage)
      } catch {
        // malformed JSON line — skip and keep polling
      }
    }
  }
}