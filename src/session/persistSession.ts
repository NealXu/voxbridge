import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SessionData {
  sessionId: string;
  updatedAt: string;
}

/** 默认会话过期时长：7 天。超过此时间戳的 sessionId 不再用于 resume。 */
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** loadSession 的返回结果，区分"无文件/过期/有数据"。 */
export type LoadSessionResult =
  | { kind: "absent" }
  | { kind: "expired"; updatedAt: string; ageMs: number }
  | { kind: "valid"; sessionId: string; updatedAt: string };

/**
 * Load session ID from persistence file, with expiry check.
 *
 * 三种返回：
 *   - absent: 文件不存在或无效（解析失败/字段缺失）
 *   - expired: updatedAt 超过 maxAgeMs（默认 7 天）
 *   - valid: sessionId 可用
 */
export function loadSession(
  sessionFile: string,
  maxAgeMs: number = DEFAULT_SESSION_TTL_MS,
): LoadSessionResult {
  try {
    if (!existsSync(sessionFile)) {
      return { kind: "absent" };
    }

    const content = readFileSync(sessionFile, "utf8");
    const data = JSON.parse(content) as SessionData;

    if (typeof data.sessionId !== "string" || !data.sessionId) {
      return { kind: "absent" };
    }

    // updatedAt 缺失或非法 → 视为过期（保守）
    if (typeof data.updatedAt !== "string") {
      return { kind: "expired", updatedAt: "", ageMs: Infinity };
    }
    const updatedMs = new Date(data.updatedAt).getTime();
    if (!Number.isFinite(updatedMs)) {
      return { kind: "expired", updatedAt: data.updatedAt, ageMs: Infinity };
    }
    const ageMs = Date.now() - updatedMs;
    if (ageMs > maxAgeMs) {
      return { kind: "expired", updatedAt: data.updatedAt, ageMs };
    }

    return { kind: "valid", sessionId: data.sessionId, updatedAt: data.updatedAt };
  } catch {
    // File read error, parse error, or invalid data
    return { kind: "absent" };
  }
}

/**
 * 向后兼容：仅返回 sessionId 或 undefined（忽略过期检查）。
 * 新代码应优先使用 loadSession()。
 */
export function loadSessionId(sessionFile: string): string | undefined {
  const r = loadSession(sessionFile);
  return r.kind === "valid" ? r.sessionId : undefined;
}

/**
 * Save session ID to persistence file.
 * Silently ignores errors to avoid blocking the main flow.
 */
export function saveSessionId(sessionFile: string, sessionId: string): void {
  try {
    // Ensure parent directory exists
    const dir = dirname(sessionFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data: SessionData = {
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    writeFileSync(sessionFile, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // Silently ignore write errors - don't block main flow
  }
}

/**
 * Clear session ID by deleting the persistence file.
 * Silently ignores errors if file doesn't exist or can't be deleted.
 */
export function clearSessionId(sessionFile: string): void {
  try {
    if (existsSync(sessionFile)) {
      unlinkSync(sessionFile);
    }
  } catch {
    // Silently ignore delete errors
  }
}