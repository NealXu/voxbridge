import { test } from "node:test";
import assert from "node:assert/strict";
import { teamObserverHook, mapInputToTeamEvent } from "../src/executor/teamHooks.js";
import type { TeamEvent } from "../src/executor/types.js";

test("hook is non-blocking and resolves {} even without fields", async () => {
  const hook = teamObserverHook("task_created");
  assert.deepEqual(await hook({}), {});
});

test("task_created hook maps fields and forwards to onTeamEvent", async () => {
  const events: TeamEvent[] = [];
  const hook = teamObserverHook("task_created", (event) => events.push(event));

  const result = await hook({
    task_id: "t1",
    task_subject: "write docs",
    teammate_name: "alice",
    team_name: "meta",
  });

  assert.deepEqual(result, {});
  assert.deepEqual(events.length, 1);
  assert.equal(events[0]?.kind, "task_created");
  assert.equal(events[0]?.taskId, "t1");
  assert.equal(events[0]?.subject, "write docs");
  assert.equal(events[0]?.teammate, "alice");
  assert.equal(events[0]?.teamName, "meta");
});

test("task_completed hook maps fields and forwards to onTeamEvent", async () => {
  const events: TeamEvent[] = [];
  const hook = teamObserverHook("task_completed", (event) => events.push(event));

  await hook({ task_id: "t2", task_subject: "landing page" });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "task_completed");
  assert.equal(events[0]?.taskId, "t2");
  assert.equal(events[0]?.subject, "landing page");
});

test("teammate_idle hook maps teammate_name and forwards to onTeamEvent", async () => {
  const events: TeamEvent[] = [];
  const hook = teamObserverHook("teammate_idle", (event) => events.push(event));

  await hook({ teammate_name: "alice", team_name: "meta" });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "teammate_idle");
  assert.equal(events[0]?.teammate, "alice");
  assert.equal(events[0]?.teamName, "meta");
});

test("hook without onTeamEvent does not throw", async () => {
  const hook = teamObserverHook("task_created");
  assert.deepEqual(await hook({ task_id: "t1", task_subject: "x" }), {});
});

test("mapInputToTeamEvent returns null for missing required fields", () => {
  assert.equal(mapInputToTeamEvent("task_created", {}), null);
  assert.equal(mapInputToTeamEvent("task_completed", { task_id: "t1" }), null);
  assert.equal(mapInputToTeamEvent("teammate_idle", { teammate_name: 42 }), null);
});

test("mapInputToTeamEvent ignores unknown kinds", () => {
  assert.equal(mapInputToTeamEvent("something_else", { task_id: "t1", task_subject: "x" }), null);
});