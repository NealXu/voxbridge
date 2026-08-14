/**
 * Claude executable path resolution.
 *
 * @module executor/claudePath
 */

import { execSync } from "node:child_process";
import { platform } from "node:os";

/**
 * Resolves the path to the Claude Code executable.
 *
 * Resolution order:
 * 1. CLAUDE_EXECUTABLE_PATH environment variable (if set)
 * 2. System path lookup via `where` (Windows) or `which` (Unix)
 * 3. Fallback to 'claude' string
 *
 * @returns The path to the Claude executable
 */
export function resolveClaudePath(): string {
  // 1. Check environment variable override
  const envPath = process.env.CLAUDE_EXECUTABLE_PATH;
  if (envPath) {
    return envPath;
  }

  // 2. Try system path lookup
  try {
    const isWindows = platform() === "win32";
    const command = isWindows ? "where claude" : "which claude";
    const result = execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // On Windows, 'where' may return multiple paths (one per line)
    // Return the first one
    if (result) {
      return result.split("\n")[0].trim();
    }
  } catch {
    // Command failed - claude not found in PATH, fall through to fallback
  }

  // 3. Fallback to bare command name
  return "claude";
}