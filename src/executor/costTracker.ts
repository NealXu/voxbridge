import type { CompletionStats } from "./types.js";

/**
 * Aggregates cost and duration counters across an execution.
 *
 * Accumulates per-message API cost and duration deltas so the UI can
 * render a single completion summary (cost / duration / turn count).
 */
export class CostTracker {
  private totalCostUsd = 0;
  private totalDurationMs = 0;
  private turns = 0;

  /**
   * Add a cost/duration sample (e.g. from a result message).
   *
   * @param result - Sample fields, matching SDKMessage's result shape
   */
  add(result: { total_cost_usd?: number; duration_ms?: number }): void {
    if (typeof result.total_cost_usd === "number") {
      this.totalCostUsd += result.total_cost_usd;
    }
    if (typeof result.duration_ms === "number") {
      this.totalDurationMs += result.duration_ms;
      this.turns += 1;
    }
  }

  /** Return aggregated completion statistics. */
  getStats(): CompletionStats {
    return {
      durationMs: this.totalDurationMs,
      costUsd: this.totalCostUsd,
      turns: this.turns,
    };
  }

  /** Reset all accumulated counters. */
  reset(): void {
    this.totalCostUsd = 0;
    this.totalDurationMs = 0;
    this.turns = 0;
  }
}