/**
 * ExecutorRegistry manages the pool of persistent Claude Code executors.
 *
 * Each chatId is mapped to one long-running executor so a conversation
 * survives across turns without respawning the process. A release marks
 * the executor idle; after a configurable idle timeout the instance is
 * disposed and removed from the pool. `maxConcurrent` bounds the number
 * of live processes, evicting the least-recently-used idle executor when
 * the pool is full.
 *
 * @module executor/registry
 */

import { PersistentClaudeExecutor } from "./persistentExecutor.js";
import type { PersistentExecutorLike } from "./persistentExecutor.js";

export type { PersistentExecutorLike } from "./persistentExecutor.js";

/** Minimal logger surface accepted by {@link ExecutorRegistry}. */
export interface RegistryLogger {
  debug?: (message: string) => void;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string, error?: unknown) => void;
}

/** Options for creating an {@link ExecutorRegistry}. */
export interface ExecutorRegistryOptions {
  /** Optional logger for lifecycle events. */
  logger?: RegistryLogger;
  /**
   * Milliseconds an executor stays pooled after its last release before
   * being disposed. When omitted or 0, executors are disposed immediately
   * on release.
   */
  idleTimeoutMs?: number;
  /** Maximum number of concurrently live executors (default 5). */
  maxConcurrent?: number;
}

/** A pooled executor plus its lease bookkeeping. */
export interface RegistryEntry<T extends PersistentExecutorLike = PersistentExecutorLike> {
  /** The pooled persistent executor. */
  executor: T;
  /** Number of outstanding {@link ExecutorRegistry.acquire} leases. */
  leases: number;
  /** Timestamp (ms) of the most recent acquire. */
  lastUsedAt: number;
}

/** Options for acquiring an executor from the pool. */
export interface AcquireOptions {
  /** Working directory the persistent process should run in. */
  cwd: string;
}

/**
 * Pool of persistent executors keyed by chatId.
 */
export class ExecutorRegistry {
  /** Default bound on concurrently live executors. */
  static readonly DEFAULT_MAX_CONCURRENT = 5;

  private executors = new Map<string, RegistryEntry<PersistentExecutorLike>>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly idleTimeoutMs: number | undefined;
  private readonly maxConcurrent: number;
  private readonly logger: RegistryLogger;

  constructor(options: ExecutorRegistryOptions = {}) {
    this.logger = options.logger ?? {};
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.maxConcurrent = options.maxConcurrent ?? ExecutorRegistry.DEFAULT_MAX_CONCURRENT;
  }

  /**
   * The current entry for a chat, or undefined when not pooled.
   *
   * @param chatId - Chat to look up
   */
  peek(chatId: string): RegistryEntry<PersistentExecutorLike> | undefined {
    return this.executors.get(chatId);
  }

  /**
   * Acquire the executor for a chat, creating it on first use.
   *
   * Acquiring an already-pooled chat clears any pending idle timer and
   * increments the lease count. If the pool is at `maxConcurrent` the
   * least-recently-used idle executor is evicted to make room; if none is
   * idle the acquire rejects.
   *
   * @param chatId - Chat to bind the executor to
   * @param opts - Acquisition options
   * @returns The pooled entry for the chat
   * @throws When the pool is saturated and no idle executor can be evicted
   */
  async acquire(chatId: string, opts: AcquireOptions): Promise<RegistryEntry<PersistentExecutorLike>> {
    const existing = this.executors.get(chatId);
    if (existing) {
      this.clearIdleTimer(chatId);
      existing.leases += 1;
      existing.lastUsedAt = Date.now();
      this.logger.debug?.(`executor reused: ${chatId} leases=${existing.leases}`);
      return existing;
    }

    this.evictIfAtCapacity(chatId);

    const entry: RegistryEntry<PersistentExecutorLike> = {
      executor: new PersistentClaudeExecutor({ chatId, cwd: opts.cwd }),
      leases: 1,
      lastUsedAt: Date.now(),
    };
    this.executors.set(chatId, entry);
    this.logger.debug?.(`executor created: ${chatId} (pool=${this.executors.size}/${this.maxConcurrent})`);
    return entry;
  }

  /**
   * Release a lease for a chat.
   *
   * When the last lease is released the executor is disposed — either
   * immediately, or after `idleTimeoutMs` when configured. An acquire for
   * the same chat before the idle timer fires cancels the disposal.
   *
   * @param chatId - Chat whose lease is being released
   * @param reason - Human-readable reason, attached to the disposal
   */
  async release(chatId: string, reason: string): Promise<void> {
    const entry = this.executors.get(chatId);
    if (!entry) {
      this.logger.warn?.(`release of unknown executor: ${chatId}`);
      return;
    }

    entry.leases = Math.max(0, entry.leases - 1);
    this.logger.debug?.(`executor released: ${chatId} (${reason}) leases=${entry.leases}`);
    if (entry.leases > 0) return;

    if (this.idleTimeoutMs && this.idleTimeoutMs > 0) {
      // Keep the instance pooled for a while; dispose it once idle.
      const timer = setTimeout(() => {
        void this.dispose(chatId, "idle timeout");
      }, this.idleTimeoutMs);
      timer.unref?.();
      this.idleTimers.set(chatId, timer);
    } else {
      await this.dispose(chatId, reason);
    }
  }

  /**
   * Shut down every pooled executor, clearing pending idle timers.
   *
   * Safe to call more than once.
   *
   * @param reason - Human-readable reason for the shutdown
   */
  async shutdownAll(reason: string): Promise<void> {
    const chatIds = [...this.executors.keys()];
    await Promise.all(chatIds.map((chatId) => this.dispose(chatId, reason)));
  }

  /**
   * When the pool is full, evict the least-recently-used idle executor.
   *
   * @param chatId - Chat being acquired, used for the error message only
   * @throws When at capacity and no executor is idle
   */
  private evictIfAtCapacity(chatId: string): void {
    if (this.executors.size < this.maxConcurrent) return;

    let evictId: string | undefined;
    let oldest = Infinity;
    for (const [key, entry] of this.executors) {
      if (entry.leases > 0) continue;
      if (entry.lastUsedAt < oldest) {
        oldest = entry.lastUsedAt;
        evictId = key;
      }
    }

    if (evictId !== undefined) {
      this.logger.warn?.(`evicting idle executor: ${evictId} to make room for ${chatId}`);
      void this.dispose(evictId, `evicted (maxConcurrent=${this.maxConcurrent})`);
      return;
    }

    throw new Error(
      `ExecutorRegistry maxConcurrent (${this.maxConcurrent}) reached; cannot acquire ${chatId}`
    );
  }

  /**
   * Remove an entry from the pool and shut its executor down.
   *
   * Idempotent: a second call for the same chat is a no-op.
   *
   * @param chatId - Chat whose executor should be disposed
   * @param reason - Human-readable reason, attached to the disposal
   */
  private async dispose(chatId: string, reason: string): Promise<void> {
    const entry = this.executors.get(chatId);
    if (!entry) return;

    this.clearIdleTimer(chatId);
    this.executors.delete(chatId);
    await entry.executor.shutdown(reason);
    this.logger.debug?.(`executor disposed: ${chatId} (${reason})`);
  }

  private clearIdleTimer(chatId: string): void {
    const timer = this.idleTimers.get(chatId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.idleTimers.delete(chatId);
    }
  }
}