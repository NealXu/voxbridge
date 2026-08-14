/**
 * SDK-mode executor module for Claude Code.
 *
 * This module provides a high-level API for programmatically controlling
 * Claude Code through the Agent SDK, with stream processing, session
 * management, and Agent Teams support.
 *
 * @example
 * ```ts
 * import { createClaudeExecutor, StreamProcessor } from "./executor";
 *
 * const executor = createClaudeExecutor({
 *   cwd: process.cwd(),
 *   abortController: new AbortController(),
 * });
 *
 * const handle = executor.startExecution({
 *   cwd: process.cwd(),
 *   abortController: new AbortController(),
 * });
 *
 * const processor = new StreamProcessor({ userPrompt: "Hello" });
 *
 * for await (const msg of handle.stream) {
 *   const state = processor.processMessage(msg);
 *   console.log(state);
 * }
 * ```
 *
 * @module executor
 */

// Re-export all types
export type {
  SDKMessage,
  ExecutorOptions,
  ExecutionHandle,
  CardState,
  ToolCall,
  ToolCallInfo,
  TeamEvent,
  TeamState,
  TeamMember,
  TeamTask,
  PendingQuestion,
  CompletionStats,
} from "./types.js";

// Re-export main classes
export { ClaudeExecutor, executePrompt } from "./claudeExecutor.js";
export { StreamProcessor, isCompleteMessage, isErrorMessage, isWaitingForInputMessage } from "./streamProcessor.js";
export { AsyncQueue } from "./inputQueue.js";
export { CostTracker } from "./costTracker.js";

// Re-export helper utilities
export { resolveClaudePath } from "./claudePath.js";
export { buildChildEnv } from "./envFilter.js";
export { ErrorCode, formatError, isRecoverable } from "./errors.js";
export { MAX_CRASHES, handleCrash, resetCrashCount, getCrashCount } from "./crashRecovery.js";

// Re-export StreamProcessorOptions for convenience
export type { StreamProcessorOptions } from "./streamProcessor.js";

import { ClaudeExecutor } from "./claudeExecutor.js";
import type { ExecutorOptions } from "./types.js";

/**
 * Factory function to create a ClaudeExecutor instance.
 *
 * This is the recommended way to create an executor when you don't need
 * to customize the SDK query implementation (e.g., for testing).
 *
 * @param options - Execution options (partial - only required fields are needed)
 * @returns A new ClaudeExecutor instance
 *
 * @example
 * ```ts
 * const executor = createClaudeExecutor();
 *
 * const handle = executor.startExecution({
 *   cwd: "/path/to/project",
 *   abortController: new AbortController(),
 *   model: "claude-opus-5",
 * });
 *
 * for await (const msg of handle.stream) {
 *   console.log(msg.type);
 * }
 * ```
 */
export function createClaudeExecutor(
  options?: Partial<ExecutorOptions>
): ClaudeExecutor {
  // Options can be used for future extensions (e.g., custom query implementation)
  // For now, we just create a default executor
  return new ClaudeExecutor();
}