/**
 * Environment variable filtering for child processes.
 *
 * Filters CLAUDE* environment variables to prevent unwanted leakage
 * into child process contexts, with an explicit whitelist for
 * variables that should be passed through.
 *
 * @module executor/envFilter
 */

/**
 * Whitelisted CLAUDE* environment variables that should be passed to child processes.
 */
const CLAUDE_WHITELIST = new Set([
  "CLAUDE_EXPERIMENTAL_AGENT_TEAMS",
  "CLAUDE_DISABLE_AUTO_MEMORY",
]);

/**
 * Builds a filtered environment object for child processes.
 *
 * Filters out all CLAUDE* environment variables except those in the whitelist,
 * then merges in any provided overrides.
 *
 * @param overrides - Additional environment variables to merge into the result
 * @returns Filtered environment object safe for child process spawning
 */
export function buildChildEnv(
  overrides?: Record<string, string>
): Record<string, string> {
  const filtered: Record<string, string> = {};

  // Copy all env vars except filtered CLAUDE* vars
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    // Filter CLAUDE* vars: only keep whitelisted ones
    if (key.startsWith("CLAUDE_")) {
      if (CLAUDE_WHITELIST.has(key)) {
        filtered[key] = value;
      }
      // Non-whitelisted CLAUDE* vars are skipped
    } else {
      // Non-CLAUDE vars are always kept
      filtered[key] = value;
    }
  }

  // Merge overrides on top
  if (overrides) {
    Object.assign(filtered, overrides);
  }

  return filtered;
}