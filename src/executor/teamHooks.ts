/**
 * Agent Teams observer hooks.
 *
 * The Claude Code SDK can surface Agent Teams lifecycle events to the
 * host process through hook-style callbacks. These helpers translate the
 * hook input payload — task_id / task_subject / teammate_name / team_name
 * — into the typed {@link TeamEvent} model used throughout the executor
 * so a team panel and the team state reducer can consume them uniformly.
 *
 * Hooks are non-blocking by design: they always resolve `{}` immediately.
 *
 * @module executor/teamHooks
 */

import type { TeamEvent } from "./types.js";

/**
 * Hook function signature: runs in the SDK hook context and must not
 * block the underlying process.
 */
export type TeamObserverHook = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Map a hook input payload into a typed {@link TeamEvent}.
 *
 * Required fields vary by kind: task events need `task_id` + `task_subject`,
 * idle events need `teammate_name`. `team_name` is optional and preserved
 * on the event so the team state can track the team's name.
 *
 * @param kind - One of 'task_created' | 'task_completed' | 'teammate_idle'
 * @param input - Raw hook payload
 * @returns The mapped event, or null when the payload is missing required fields
 */
export function mapInputToTeamEvent(kind: string, input: Record<string, unknown>): TeamEvent | null {
  const teamName = typeof input.team_name === "string" ? input.team_name : undefined;
  const teammate = typeof input.teammate_name === "string" ? input.teammate_name : undefined;

  if (kind === "teammate_idle") {
    return teammate ? { kind: "teammate_idle", teammate, teamName } : null;
  }

  const taskId = typeof input.task_id === "string" ? input.task_id : undefined;
  const subject = typeof input.task_subject === "string" ? input.task_subject : undefined;
  if (!taskId || !subject) return null;

  if (kind === "task_created") {
    return { kind: "task_created", taskId, subject, teammate, teamName };
  }
  if (kind === "task_completed") {
    return { kind: "task_completed", taskId, subject, teammate, teamName };
  }
  return null;
}

/**
 * Create a non-blocking observer hook for a Team event kind.
 *
 * @param kind - Team lifecycle kind to observe
 * @param onTeamEvent - Optional listener invoked with the mapped event
 * @returns A hook function that resolves `{}` without blocking
 */
export function teamObserverHook(
  kind: string,
  onTeamEvent?: (event: TeamEvent) => void
): (input: Record<string, unknown>) => Promise<Record<string, unknown>> {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const event = mapInputToTeamEvent(kind, input);
    if (event) onTeamEvent?.(event);
    return {};
  };
}