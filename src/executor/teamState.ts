/**
 * Agent Teams state tracking for the Claude Code Executor.
 *
 * Keeps a pure, immutable model of teammates and tasks so the UI and
 * Team event hooks can render Agent Teams activity without reaching into
 * the SDK. Team size is validated against {@link MAX_TEAMMATES} by
 * callers before admitting new teammates.
 *
 * @module executor/teamState
 */

import type { TeamEvent, TeamState, TeamTask } from "./types.js";

/** Maximum number of teammates allowed in a single team. */
export const MAX_TEAMMATES = 10;

/**
 * Validate that a team size is within the supported bound.
 *
 * @param count - Number of teammates
 * @returns True when `0 <= count <= MAX_TEAMMATES`
 */
export function validateTeamSize(count: number): boolean {
  return Number.isInteger(count) && count >= 0 && count <= MAX_TEAMMATES;
}

/**
 * Apply a {@link TeamEvent} to a {@link TeamState}.
 *
 * Returns a new state; the input state is never mutated. Unknown tasks or
 * teammates are tolerated: duplicates and unknown task IDs are no-ops.
 *
 * @param state - Current team state
 * @param event - Event to fold into the state
 * @returns The updated team state
 */
export function updateTeamState(state: TeamState, event: TeamEvent): TeamState {
  switch (event.kind) {
    case "task_created":
      return applyTaskCreated(state, event);
    case "task_completed":
      return applyTaskCompleted(state, event);
    case "teammate_idle":
      return applyTeammateIdle(state, event);
  }
}

type TaskCreated = Extract<TeamEvent, { kind: "task_created" }>;
type TaskCompleted = Extract<TeamEvent, { kind: "task_completed" }>;
type TeammateIdle = Extract<TeamEvent, { kind: "teammate_idle" }>;

/** Fold a task_created event: add the task and mark the teammate working. */
function applyTaskCreated(state: TeamState, event: TaskCreated): TeamState {
  // Duplicate task IDs are ignored.
  if (state.tasks.some((t) => t.taskId === event.taskId)) return state;

  const task: TeamTask = {
    taskId: event.taskId,
    subject: event.subject,
    status: "in_progress",
    teammate: event.teammate,
  };

  let teammates = state.teammates;
  if (event.teammate) {
    const idx = teammates.findIndex((m) => m.name === event.teammate);
    if (idx >= 0) {
      const member = teammates[idx];
      teammates = [
        ...teammates.slice(0, idx),
        { ...member, status: "working", lastSubject: event.subject },
        ...teammates.slice(idx + 1),
      ];
    } else {
      teammates = [
        ...teammates,
        { name: event.teammate, status: "working", lastSubject: event.subject },
      ];
    }
  }

  return {
    name: event.teamName ?? state.name,
    teammates,
    tasks: [...state.tasks, task],
  };
}

/** Fold a task_completed event: mark the task complete. */
function applyTaskCompleted(state: TeamState, event: TaskCompleted): TeamState {
  const idx = state.tasks.findIndex((t) => t.taskId === event.taskId);
  if (idx < 0) return state;

  const tasks = [
    ...state.tasks.slice(0, idx),
    { ...state.tasks[idx], status: "completed" as const },
    ...state.tasks.slice(idx + 1),
  ];
  return { name: state.name, teammates: state.teammates, tasks };
}

/** Fold a teammate_idle event: mark the teammate idle. */
function applyTeammateIdle(state: TeamState, event: TeammateIdle): TeamState {
  const idx = state.teammates.findIndex((m) => m.name === event.teammate);
  if (idx >= 0) {
    const member = state.teammates[idx];
    if (member.status === "idle") return state;
    const teammates = [
      ...state.teammates.slice(0, idx),
      { ...member, status: "idle" as const },
      ...state.teammates.slice(idx + 1),
    ];
    return { name: state.name, teammates, tasks: state.tasks };
  }

  // First sighting of this teammate: add them as idle.
  return {
    name: event.teamName ?? state.name,
    teammates: [...state.teammates, { name: event.teammate, status: "idle" as const }],
    tasks: state.tasks,
  };
}