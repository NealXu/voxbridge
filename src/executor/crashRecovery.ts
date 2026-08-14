/**
 * Crash recovery tracking for the Claude Code Executor.
 *
 * Tracks consecutive crashes per component (keyed by chatId / worker
 * name) so the app can restart a crashed component a bounded number
 * of times before giving up. A successful recovery resets the counter.
 *
 * @module executor/crashRecovery
 */

/**
 * Maximum consecutive crashes before giving up on recovery.
 *
 * Mirrors the STT worker policy: 3 consecutive crashes trigger exit.
 */
export const MAX_CRASHES = 3;

/** Consecutive crash count per component key. */
const crashCounts = new Map<string, number>();

/**
 * Record a crash for the given key.
 *
 * Increments the consecutive crash counter for the key and reports
 * whether recovery should still be attempted.
 *
 * @param key - Component identifier (chatId, worker name, etc.)
 * @returns True if a recovery attempt is still allowed (count < MAX_CRASHES),
 *          false once the crash limit has been reached
 */
export function handleCrash(key: string): boolean {
  const count = (crashCounts.get(key) ?? 0) + 1;
  crashCounts.set(key, count);
  return count < MAX_CRASHES;
}

/**
 * Reset the consecutive crash counter for a key.
 *
 * Call after a successful recovery (e.g. the restarted component
 * reported ready/healthy).
 *
 * @param key - Component identifier to reset
 */
export function resetCrashCount(key: string): void {
  crashCounts.delete(key);
}

/**
 * Get the current consecutive crash count for a key.
 *
 * @param key - Component identifier to query
 * @returns The number of consecutive crashes recorded, 0 if none
 */
export function getCrashCount(key: string): number {
  return crashCounts.get(key) ?? 0;
}