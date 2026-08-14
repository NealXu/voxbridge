/**
 * Persistent executor for the ExecutorRegistry process pool.
 *
 * A persistent executor owns a long-running Claude Code process and an
 * input queue that survives across conversation turns, so a chat can be
 * resumed without respawning the process for every prompt.
 *
 * The full SDK wiring (process spawn, stream handling) lives in
 * {@link ClaudeExecutor}. This module provides the minimal interface the
 * registry depends on, plus an {@link AsyncQueue}-driven scaffold so the
 * registry can be exercised end-to-end in isolation. The concrete
 * PersistentClaudeExecutor will spawn a real cc process once the two are
 * unified.
 *
 * @module executor/persistentExecutor
 */

import { AsyncQueue } from "./inputQueue.js";

/**
 * The lifecycle surface the process pool needs from an executor.
 *
 * The registry is deliberately typed against this minimal interface so
 * the pool stays decoupled from the SDK and easy to test with fakes.
 */
export interface PersistentExecutorLike {
  /** Chat / conversation key this executor is bound to. */
  readonly chatId: string;
  /** Working directory the process runs in. */
  readonly cwd: string;
  /** Timestamp (ms) when the executor was created. */
  readonly createdAt: number;
  /** Async queue for cross-turn user input. */
  readonly queue: AsyncQueue<string>;
  /** True once {@link shutdown} has been called. */
  readonly isDisposed: boolean;
  /** Enqueue a user message for the next turn. */
  send(message: string): void;
  /** Gracefully stop the executor, finishing its input queue. */
  shutdown(reason: string): Promise<void>;
}

/** Options for constructing a persistent executor. */
export interface PersistentExecutorOptions {
  /** Chat / conversation key this executor is bound to. */
  chatId: string;
  /** Working directory the process runs in. */
  cwd: string;
}

/**
 * AsyncQueue-driven scaffold for a persistent Claude Code process.
 *
 * Keeps the cross-turn input queue that the real SDK wiring will consume
 * from; for now the process spawning is stubbed out.
 */
export class PersistentClaudeExecutor implements PersistentExecutorLike {
  readonly chatId: string;
  readonly cwd: string;
  readonly createdAt: number;
  readonly queue = new AsyncQueue<string>();
  private disposed = false;

  constructor(options: PersistentExecutorOptions) {
    this.chatId = options.chatId;
    this.cwd = options.cwd;
    this.createdAt = Date.now();
  }

  /** Whether this executor has been shut down. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Enqueue a user message for the next turn of this process.
   *
   * @param message - The user turn to deliver
   * @throws If the executor has already been shut down
   */
  send(message: string): void {
    if (this.disposed) {
      throw new Error("Cannot send to a disposed executor");
    }
    this.queue.enqueue(message);
  }

  /**
   * Shut the process down gracefully.
   *
   * Finishing the input queue lets an SDK consumer (once wired) drain the
   * remaining turns, then end the prompt iterable.
   *
   * @param reason - Human-readable reason, surfaced via the registry logger
   */
  async shutdown(reason: string): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.finish();
  }
}