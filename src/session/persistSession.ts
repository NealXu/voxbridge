import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SessionData {
  sessionId: string;
  updatedAt: string;
}

/**
 * Load session ID from persistence file.
 * Returns undefined if file doesn't exist or is invalid.
 */
export function loadSessionId(sessionFile: string): string | undefined {
  try {
    if (!existsSync(sessionFile)) {
      return undefined;
    }

    const content = readFileSync(sessionFile, "utf8");
    const data = JSON.parse(content) as SessionData;

    if (typeof data.sessionId === "string" && data.sessionId) {
      return data.sessionId;
    }

    return undefined;
  } catch {
    // File read error, parse error, or invalid data - return undefined
    return undefined;
  }
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