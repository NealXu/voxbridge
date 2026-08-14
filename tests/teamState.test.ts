import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TEAMMATES, validateTeamSize, updateTeamState } from "../src/executor/teamState.js";
import type { TeamState } from "../src/executor/types.js";

const baseState: TeamState = { teammates: [], tasks: [] };

test("validateTeamSize accepts up to MAX_TEAMMATES", () => {
  assert.equal(validateTeamSize(0), true);
  assert.equal(validateTeamSize(MAX_TEAMMATES), true);
});

test("validateTeamSize rejects sizes over the limit", () => {
  assert.equal(validateTeamSize(11), false);
  assert.equal(validateTeamSize(100), false);
});

test("validateTeamSize rejects negative and non-integer counts", () => {
  assert.equal(validateTeamSize(-1), false);
  assert.equal(validateTeamSize(10.5), false);
});

test("task_created adds an in-progress task", () => {
  const state = updateTeamState(baseState, {
    kind: "task_created",
    taskId: "t1",
    subject: "write tests",
  });

  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0]?.taskId, "t1");
  assert.equal(state.tasks[0]?.subject, "write tests");
  assert.equal(state.tasks[0]?.status, "in_progress");
});

test("task_created marks the assigned teammate working", () => {
  const state = updateTeamState(baseState, {
    kind: "task_created",
    taskId: "t1",
    subject: "fix bug",
    teammate: "alice",
  });

  assert.deepEqual(state.teammates, [
    { name: "alice", status: "working", lastSubject: "fix bug" },
  ]);
});

test("task_created flips an existing teammate back to working", () => {
  const state = updateTeamState(
    { teammates: [{ name: "alice", status: "idle" }], tasks: [] },
    { kind: "task_created", taskId: "t1", subject: "fix bug", teammate: "alice" }
  );

  assert.deepEqual(state.teammates, [
    { name: "alice", status: "working", lastSubject: "fix bug" },
  ]);
});

test("task_created is idempotent for a duplicate task id", () => {
  const once = updateTeamState(baseState, { kind: "task_created", taskId: "t1", subject: "a" });
  const twice = updateTeamState(once, { kind: "task_created", taskId: "t1", subject: "b" });

  assert.equal(twice.tasks.length, 1);
  assert.equal(twice.tasks[0]?.subject, "a");
});

test("task_completed marks the task complete but keeps the teammate working", () => {
  let state = updateTeamState(baseState, {
    kind: "task_created",
    taskId: "t1",
    subject: "fix bug",
    teammate: "alice",
  });
  state = updateTeamState(state, {
    kind: "task_completed",
    taskId: "t1",
    subject: "fix bug",
    teammate: "alice",
  });

  assert.equal(state.tasks[0]?.status, "completed");
  assert.equal(state.tasks[0]?.teammate, "alice");
  assert.equal(state.teammates[0]?.status, "working");
});

test("task_completed for an unknown task is a no-op", () => {
  const state = updateTeamState(baseState, {
    kind: "task_completed",
    taskId: "missing",
    subject: "x",
  });

  assert.deepEqual(state.tasks, []);
});

test("teammate_idle marks an existing teammate idle", () => {
  const state = updateTeamState(
    {
      teammates: [{ name: "alice", status: "working", lastSubject: "fix bug" }],
      tasks: [],
    },
    { kind: "teammate_idle", teammate: "alice" }
  );

  assert.deepEqual(state.teammates, [
    { name: "alice", status: "idle", lastSubject: "fix bug" },
  ]);
});

test("teammate_idle adds an unknown teammate as idle", () => {
  const state = updateTeamState(baseState, { kind: "teammate_idle", teammate: "bob" });

  assert.deepEqual(state.teammates, [{ name: "bob", status: "idle" }]);
});

test("an already-idle teammate stays idle", () => {
  const state = updateTeamState(
    { teammates: [{ name: "alice", status: "idle" }], tasks: [] },
    { kind: "teammate_idle", teammate: "alice" }
  );

  assert.deepEqual(state.teammates, [{ name: "alice", status: "idle" }]);
});

test("team events carry the team name through", () => {
  const state = updateTeamState(baseState, {
    kind: "teammate_idle",
    teammate: "alice",
    teamName: "meta",
  });

  assert.equal(state.name, "meta");
});

test("updateTeamState does not mutate the previous state", () => {
  const state = updateTeamState(baseState, {
    kind: "task_created",
    taskId: "t1",
    subject: "x",
    teammate: "alice",
  });

  assert.ok(state !== baseState);
  assert.deepEqual(baseState, { teammates: [], tasks: [] });
});

test("callers gate team growth with validateTeamSize", () => {
  let state: TeamState = { teammates: [], tasks: [] };
  for (let i = 0; i < MAX_TEAMMATES; i++) {
    state = updateTeamState(state, { kind: "teammate_idle", teammate: `m${i}` });
  }
  assert.equal(validateTeamSize(state.teammates.length), true);

  state = updateTeamState(state, { kind: "teammate_idle", teammate: "overflow" });
  assert.equal(validateTeamSize(state.teammates.length), false);
});