/**
 * Error codes and user-facing messages for the Claude Code Executor.
 *
 * Centralizes error classification so UI, STT routing, and executor
 * code all render consistent, user-friendly Chinese messages and
 * share a single definition of which failures are recoverable.
 *
 * @module executor/errors
 */

/**
 * Canonical error codes for voxcode execution failures.
 *
 * Categories:
 * - Environment problems (mic, model, Claude Code CLI not found)
 * - Runtime failures (crash, lost stream, resume failure)
 * - Worker failures (STT worker exited unexpectedly)
 */
export const ErrorCode = {
  /** Microphone unavailable or permission denied */
  EC_MIC_UNAVAILABLE: "EC_MIC_UNAVAILABLE",
  /** Model not configured in Claude Code settings */
  EC_MODEL_MISSING: "EC_MODEL_MISSING",
  /** Claude Code CLI binary not found on PATH */
  EC_CC_NOT_FOUND: "EC_CC_NOT_FOUND",
  /** Claude Code process crashed mid-execution */
  EC_CC_CRASH: "EC_CC_CRASH",
  /** SDK message stream broke (network/connection lost) */
  EC_SDK_STREAM: "EC_SDK_STREAM",
  /** Session resume failed (session missing or corrupted) */
  EC_RESUME_FAILED: "EC_RESUME_FAILED",
  /** STT worker process exited unexpectedly */
  EC_WORKER_CRASH: "EC_WORKER_CRASH",
} as const;

/** Union type of all {@link ErrorCode} values. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** User-friendly Chinese messages keyed by error code. */
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.EC_MIC_UNAVAILABLE]:
    "麦克风不可用，请检查麦克风连接和系统录音权限。",
  [ErrorCode.EC_MODEL_MISSING]:
    "未配置可用的模型，请在 ~/.claude/settings.json 中设置 ANTHROPIC_MODEL 后重试。",
  [ErrorCode.EC_CC_NOT_FOUND]:
    "未找到 Claude Code CLI，请确认已安装 claude 并加入 PATH。",
  [ErrorCode.EC_CC_CRASH]:
    "Claude Code 进程意外崩溃，正在尝试自动恢复。",
  [ErrorCode.EC_SDK_STREAM]:
    "与 Claude Code 的数据流异常中断，请重试。",
  [ErrorCode.EC_RESUME_FAILED]:
    "会话恢复失败，将新建一个会话继续。",
  [ErrorCode.EC_WORKER_CRASH]:
    "语音识别服务（STT worker）意外退出，正在尝试重启。",
};

/**
 * Format an error code into a user-friendly Chinese message.
 *
 * @param code - The error code to format
 * @param details - Optional additional detail appended to the message
 * @returns A human-readable Chinese error string
 */
export function formatError(code: ErrorCode, details?: string): string {
  const message = ERROR_MESSAGES[code] ?? `未知错误：${code}`;
  return details ? `${message} 详情：${details}` : message;
}

/**
 * Determine whether a failure is safe to automatically retry.
 *
 * Only transient runtime failures (crash, broken stream, worker exit)
 * are recoverable; environment/config problems (mic, model, missing
 * CLI) require user intervention and must not be retried in a loop.
 *
 * @param code - The error code to classify
 * @returns True if the error can be recovered within the same session
 */
export function isRecoverable(code: ErrorCode): boolean {
  return (
    code === ErrorCode.EC_CC_CRASH ||
    code === ErrorCode.EC_SDK_STREAM ||
    code === ErrorCode.EC_WORKER_CRASH
  );
}