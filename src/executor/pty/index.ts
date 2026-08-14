/**
 * PTY mode — drive a real interactive `claude` TUI process via node-pty.
 *
 * @module executor/pty
 */

export { PtySession, escapeCwdToProjectDir } from './ptySession.js'
export type {
  PtyModule,
  PtySpawnOptions,
  PtySessionOptions,
  PtyTuning,
  PtyLogger,
  PtyExitInfo,
} from './ptySession.js'
export { JsonlWatcher } from './screenWatcher.js'
export type { JsonlWatcherOptions, JsonlOnLine } from './screenWatcher.js'