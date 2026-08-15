/**
 * 日志级别定义与工具。
 *
 * 数值越大越严重；过滤器通过数值比较实现。
 *
 * @module logger/levels
 */

/** 支持的日志级别（从低到高）。 */
export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

/** 日志级别类型。 */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** 级别 → 数值映射（用于比较过滤）。 */
export const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/** 级别 → 大写标签（格式化输出用，5 字符等宽）。 */
export const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
  fatal: "FATAL",
};

/** 解析字符串级别，未知值回退到 fallback（默认 "info"）。 */
export function parseLogLevel(raw: string | undefined, fallback: LogLevel = "info"): LogLevel {
  if (!raw) return fallback;
  const key = raw.toLowerCase().trim() as LogLevel;
  return LEVEL_VALUE[key] !== undefined ? key : fallback;
}
