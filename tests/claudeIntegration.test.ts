/**
 * End-to-end integration tests against a REAL Claude Code process spawned via
 * the claude-agent-sdk.
 *
 * These require a working `claude` CLI on PATH, API credentials (read from the
 * `env` block of `~/.claude/settings.json`) and network access to the model
 * provider, so they are SKIPPED by default. Enable them per-run:
 *
 *   CLAUDE_INTEGRATION=1 npm test                              # SDK-mode test
 *   CLAUDE_INTEGRATION=1 CLAUDE_TEAM_INTEGRATION=1 npm test    # + Agent Teams
 *
 * The skip reasons surface under `npm test` as "skipped" entries; they never
 * fail a default `npm test` run.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";

import { readSettingsEnv } from "../src/env.js";
import {
  createClaudeExecutor,
  resolveClaudePath,
  teamObserverHook,
  updateTeamState,
} from "../src/executor/index.js";
import type { TeamEvent, TeamState } from "../src/executor/index.js";

/** Run the SDK-mode integration test when the caller opts in. */
const integrationEnabled = process.env.CLAUDE_INTEGRATION === "1";

/** skip option (: false runs, : string skips) shared by both tests. */
function skipUnlessEnabled(what: string): string | false {
  if (integrationEnabled) return false;
  return `requires CLAUDE_INTEGRATION=1 to spawn a real claude process (${what}); skipped by default`;
}

/** Agent Teams test also needs an explicit opt-in on top of CLAUDE_INTEGRATION. */
function skipTeams(): string | false {
  if (!integrationEnabled) return skipUnlessEnabled("agent teams") as string;
  if (process.env.CLAUDE_TEAM_INTEGRATION !== "1") {
    return "requires CLAUDE_TEAM_INTEGRATION=1 in addition to CLAUDE_INTEGRATION=1; skipped by default";
  }
  return false;
}

/** API credentials, layered: process env, then ~/.claude/settings.json env block. */
function apiEnv(): Record<string, string> {
  return { ...(process.env as Record<string, string>), ...readSettingsEnv(process.cwd()) };
}

function hasApiCredentials(env: Record<string, string>): boolean {
  return Boolean(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY);
}

/** resolveClaudePath() returns the bare fallback "claude" when nothing matched. */
function claudeCliAvailable(): boolean {
  try {
    const resolved = resolveClaudePath();
    return Boolean(resolved && resolved !== "claude");
  } catch {
    return false;
  }
}

/** Scratch directory so a real session never touches repository files. */
function makeTempCwd(): string {
  const dir = join(tmpdir(), `voxbridge-e2e-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function removeTempCwd(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only; a leaked temp dir is harmless.
  }
}

test(
  "integration: createClaudeExecutor().startExecution yields a result for a real prompt",
  { skip: skipUnlessEnabled("createClaudeExecutor") },
  async (t) => {
    const env = apiEnv();
    if (!claudeCliAvailable()) {
      return t.skip("claude CLI not resolvable on PATH");
    }
    if (!hasApiCredentials(env)) {
      return t.skip("no ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY in ~/.claude/settings.json");
    }

    const cwd = makeTempCwd();
    t.after(() => removeTempCwd(cwd));

    const abortController = new AbortController();
    const timeoutMs = Number(process.env.CLAUDE_INTEGRATION_TIMEOUT_MS ?? 180_000);
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    t.after(() => clearTimeout(timer));

    const executor = createClaudeExecutor();
    const handle = executor.startExecution({
      cwd,
      env,
      abortController,
      maxTurns: 3,
      initialPrompt: "Reply with exactly the text: E2E-OK",
    });

    let sawAnyMessage = false;
    let sawResult = false;
    let resultText = "";
    let sessionId = "";
    let failed = false;

    try {
      for await (const msg of handle.stream) {
        sawAnyMessage = true;
        if (msg.session_id) sessionId = msg.session_id;
        if (msg.type === "result") {
          sawResult = true;
          failed = msg.is_error === true;
          resultText = msg.result ?? "";
          break;
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) throw err;
    }

    if (abortController.signal.aborted) {
      return t.skip(`claude did not produce a result within ${timeoutMs}ms; aborted (check token / model / network)`);
    }

    assert.ok(sawAnyMessage, "stream should yield at least one SDK message");
    assert.ok(sawResult, "stream should yield a result message");
    assert.equal(failed, false, "result should not be an error");
    assert.ok(resultText.trim().length > 0, "result text should be non-empty");
    assert.ok(Boolean(sessionId), "result should carry a session id");

    t.diagnostic(`session=${sessionId} result=${resultText.trim().slice(0, 80)}`);
  }
);

test(
  "integration: agent teams teamState/teamHooks path with a real session",
  { skip: skipTeams() },
  async (t) => {
    const env = apiEnv();
    if (!claudeCliAvailable()) {
      return t.skip("claude CLI not resolvable on PATH");
    }
    if (!hasApiCredentials(env)) {
      return t.skip("no ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY in ~/.claude/settings.json");
    }

    const cwd = makeTempCwd();
    t.after(() => removeTempCwd(cwd));

    const abortController = new AbortController();
    const timeoutMs = Number(process.env.CLAUDE_INTEGRATION_TIMEOUT_MS ?? 240_000);
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    t.after(() => clearTimeout(timer));

    // Wire the executor's teamHooks into the SDK's Agent Teams hook events and
    // fold every mapped TeamEvent into the shared teamState reducer.
    const events: TeamEvent[] = [];
    let state: TeamState = { teammates: [], tasks: [] };
    const observer = (kind: string) =>
      teamObserverHook(kind, (event) => {
        events.push(event);
        state = updateTeamState(state, event);
      });

    const sdkOptions = {
      cwd,
      abortController,
      env,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      maxTurns: 4,
      // Give the main agent a teammate to delegate to.
      agents: {
        minion: {
          description: "A minimal helper teammate that answers briefly.",
          prompt: "You are a minimal helper teammate. Answer in one short line.",
          tools: ["Read"],
        },
      },
      // TeamObserverHook's signature ((Record<string, unknown>) => Promise<Record<string, unknown>>)
      // is runtime-compatible with the SDK's HookCallback: it takes a hook input and
      // resolves a JSON-serializable output ({} = no-op continue).
      hooks: {
        TaskCreated: [{ hooks: [observer("task_created") as unknown as never] }],
        TaskCompleted: [{ hooks: [observer("task_completed") as unknown as never] }],
        TeammateIdle: [{ hooks: [observer("teammate_idle") as unknown as never] }],
      } as unknown as Options["hooks"],
    } as Options;

    const exec: Query = query({
      prompt:
        "Use the Task tool to delegate a trivial computation (1 + 1) to the 'minion' teammate, " +
        "then report the answer.",
      options: sdkOptions,
    });

    let resultText = "";
    let sawResult = false;
    let failed = false;

    try {
      for await (const msg of exec) {
        if (msg.type === "result") {
          sawResult = true;
          failed = msg.is_error === true;
          // Only the success variant carries `result`; errors carry `errors[]`.
          resultText =
            msg.subtype === "success" ? msg.result : (msg.errors ?? []).join("; ");
          break;
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) throw err;
    } finally {
      exec.close();
    }

    if (abortController.signal.aborted) {
      return t.skip(`claude did not produce a result within ${timeoutMs}ms; aborted`);
    }

    assert.ok(sawResult, "stream should yield a result message");
    assert.equal(failed, false, "result should not be an error");
    assert.ok(resultText.trim().length > 0, "result text should be non-empty");

    t.diagnostic(`saw ${events.length} team hook event(s): ${events.map((e) => e.kind).join(", ") || "none"}`);

    if (events.length === 0) {
      // The model is not guaranteed to delegate to a teammate, so fold-validation
      // only runs when events actually arrived; a hook-free run still proves the
      // agents/hooks wiring did not break a real session.
      t.diagnostic("no team events observed — the model did not delegate to a teammate; plumbing was still exercised");
    } else {
      // Every event must fold into a consistent teamState.
      const completed = events.filter((e) => e.kind === "task_completed").length;
      assert.ok(state.tasks.length > 0, "teamState should track tasks from real events");
      if (completed > 0) {
        assert.ok(
          state.tasks.some((task) => task.status === "completed"),
          "folded teamState should mark at least one task completed"
        );
      }
      assert.ok(state.tasks.every((task) => ["in_progress", "completed"].includes(task.status)));
    }
  }
);