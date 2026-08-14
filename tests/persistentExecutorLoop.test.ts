/**
 * Tests for the PersistentClaudeExecutor full consumption loop.
 *
 * Covers the long-lived consume loop over the SDK query stream, message
 * classification (user-turn results, spontaneous activity, continuation
 * turns, between-turn questions), the TurnHandle returned by nextTurn(),
 * and clean shutdown.
 *
 * @module executor/persistentExecutorLoop.test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PersistentClaudeExecutor } from "../src/executor/persistentExecutor.js";
import type { TurnHandle } from "../src/executor/persistentExecutor.js";
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage as LocalSDKMessage } from "../src/executor/types.js";
import { AsyncQueue } from "../src/executor/inputQueue.js";

/** Sentinel returned when the abort signal fires while the mock is mid-pull. */
const ABORTED = Symbol("aborted");

type PullResult = IteratorResult<LocalSDKMessage> | typeof ABORTED;

/**
 * Call the next pull on the mock's outgoing queue, resolving early with
 * ABORTED if `signal` fires first. Mirrors how the real SDK Query ends its
 * stream when the executor's AbortController is aborted on shutdown.
 */
async function raceIterator(
  iterator: AsyncIterator<LocalSDKMessage>,
  signal: AbortSignal | undefined
): Promise<PullResult> {
  const pull = iterator.next();
  if (!signal) return pull;
  return new Promise((resolve) => {
    const finish = (value: PullResult) => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    void pull.then((result) => finish(result));
  });
}

/**
 * A controllable stand-in for the Claude Agent SDK `query()`.
 *
 * Messages pushed via `push()` are the ones the executor's consume loop
 * receives next; `receivedInputs` captures the `type: "user"` messages the
 * executor delivers to the SDK's prompt iterable (prompts, tool_results,
 * question answers).
 */
interface MockQuery {
  queryImpl: (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => Query;
  /** Enqueue a message the SDK "emits" next. */
  push(message: LocalSDKMessage): void;
  /** End the SDK stream, as if the query completed on its own. */
  finishOutput(): void;
  /** The user messages the executor fed to the SDK prompt iterable. */
  readonly receivedInputs: SDKUserMessage[];
  /** True once `close()` was called on the returned query. */
  readonly closed: boolean;
}

function createMockQuery(): MockQuery {
  const outgoing = new AsyncQueue<LocalSDKMessage>();
  const receivedInputs: SDKUserMessage[] = [];
  let closed = false;

  const queryImpl = (params: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
  }): Query => {
    if (typeof params.prompt !== "string") {
      void (async () => {
        try {
          for await (const input of params.prompt as AsyncIterable<SDKUserMessage>) {
            receivedInputs.push(input);
          }
        } catch {
          // Ignore prompt delivery failures during teardown.
        }
      })();
    }

    const signal = params.options?.abortController?.signal;
    const query = {
      async *[Symbol.asyncIterator](): AsyncGenerator<LocalSDKMessage, void> {
        const iterator = outgoing[Symbol.asyncIterator]();
        for (;;) {
          if (signal?.aborted) return;
          const result = await raceIterator(iterator, signal);
          if (result === ABORTED) return;
          if (result.done) return;
          yield result.value;
        }
      },
      close: () => {
        closed = true;
      },
      streamInput: async () => {},
      stopTask: async () => {},
      backgroundTasks: async () => false,
    } as unknown as Query;
    return query;
  };

  return {
    queryImpl,
    push: (message) => outgoing.enqueue(message),
    finishOutput: () => outgoing.finish(),
    receivedInputs,
    get closed() {
      return closed;
    },
  };
}

function createExecutor(mock: MockQuery, chatId = "chat-1"): PersistentClaudeExecutor {
  return new PersistentClaudeExecutor({ chatId, cwd: "/tmp/project", queryImpl: mock.queryImpl });
}

/** Collect every message a turn stream yields until it ends. */
async function collectTurn(stream: AsyncIterable<LocalSDKMessage>): Promise<LocalSDKMessage[]> {
  const collected: LocalSDKMessage[] = [];
  for await (const message of stream) {
    collected.push(message);
  }
  return collected;
}

/** Poll a probe until it returns a value or the timeout elapses. */
async function waitFor<T>(
  probe: () => T | undefined,
  message: string,
  timeoutMs = 1000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Let pending microtasks / short timers settle before asserting absence. */
function flush(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("nextTurn returns a handle whose stream yields the user-turn result message", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);

  const handle: TurnHandle = executor.nextTurn("hello");
  assert.ok(handle, "nextTurn returns a handle");
  assert.ok(handle.stream, "handle exposes a stream");
  assert.equal(typeof handle.sendAnswer, "function");
  assert.equal(typeof handle.resolveQuestion, "function");
  assert.equal(typeof handle.finish, "function");
  assert.equal(executor.isDisposed, false);

  mock.push({ type: "system", subtype: "init", session_id: "sess-1" });
  mock.push({ type: "result", subtype: "success", result: "Hi there" });

  const messages = await collectTurn(handle.stream);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].type, "system");
  assert.equal(messages[1].type, "result");
  assert.equal((messages[1] as { result?: string }).result, "Hi there");

  await executor.shutdown("test complete");
  assert.ok(mock.closed, "underlying query is closed on shutdown");

  await waitFor(
    () =>
      mock.receivedInputs.some(
        (input) =>
          input.message.role === "user" &&
          typeof input.message.content === "string" &&
          input.message.content === "hello"
      )
        ? true
        : undefined,
    "nextTurn prompt should reach the SDK prompt iterable"
  );
});

test("a result with is_error finishes the turn with the error result", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);

  const handle = executor.nextTurn("do something risky");
  mock.push({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "It failed",
    errors: ["boom"],
  });

  const messages = await collectTurn(handle.stream);
  const last = messages[messages.length - 1] as { type: string; is_error?: boolean };
  assert.equal(last.type, "result");
  assert.equal(last.is_error, true);

  // The turn is over: subsequent activity must not be routed to a turn.
  const spontaneous: LocalSDKMessage[] = [];
  executor.on("spontaneous", (message) => spontaneous.push(message));
  mock.push({ type: "system", subtype: "init", session_id: "s1" });

  await waitFor(() => (spontaneous.length > 0 ? spontaneous : undefined), "spontaneous event");
  assert.equal(spontaneous.length, 1);

  await executor.shutdown("test complete");
});

test("sendAnswer and resolveQuestion forward answers to the SDK input", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);
  const handle = executor.nextTurn("plan the work");

  handle.sendAnswer("tool-1", "sess-1", "First answer");
  handle.resolveQuestion("tool-2", { name: "Alice", age: "30" });

  mock.push({ type: "result", subtype: "success", result: "ok" });
  await collectTurn(handle.stream);

  await waitFor(
    () => (mock.receivedInputs.length >= 3 ? mock.receivedInputs : undefined),
    "answers should reach the SDK prompt iterable"
  );

  const answer1 = mock.receivedInputs[1];
  const answer2 = mock.receivedInputs[2];
  const content1 = (answer1.message.content as unknown[])[0] as {
    type: string;
    tool_use_id: string;
  };
  assert.equal(answer1.parent_tool_use_id, "tool-1");
  assert.equal(content1.type, "tool_result");
  assert.equal(content1.tool_use_id, "tool-1");

  const content2 = (answer2.message.content as unknown[])[0] as {
    type: string;
    content: string;
  };
  assert.equal(answer2.parent_tool_use_id, "tool-2");
  assert.equal(content2.type, "tool_result");
  assert.ok(content2.content.includes("name: Alice"));
  assert.ok(content2.content.includes("age: 30"));

  await executor.shutdown("test complete");
});

test("activity inside a turn is routed to the turn stream, not emitted", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);

  const emitted: string[] = [];
  executor.on("spontaneous", () => emitted.push("spontaneous"));
  executor.on("between-turn-question", () => emitted.push("between-turn-question"));
  executor.on("continuation-turn", () => emitted.push("continuation-turn"));

  const handle = executor.nextTurn("read the file");
  mock.push({ type: "system", subtype: "init", session_id: "sess-1" });
  mock.push({
    type: "assistant",
    subtype: "content_block_delta",
    event: { type: "text_delta", delta: { text: "Reading..." } },
  });
  mock.push({ type: "stream_event", event: { type: "text_delta", delta: { text: "done" } } });
  mock.push({ type: "result", subtype: "success", result: "done" });

  const messages = await collectTurn(handle.stream);

  assert.equal(messages.length, 4);
  assert.equal(messages[0].type, "system");
  assert.equal(messages[3].type, "result");

  await flush();
  assert.deepEqual(emitted, [], "no events while a turn is active");

  await executor.shutdown("test complete");
});

test("messages outside any user turn emit spontaneous", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);
  const spontaneous: LocalSDKMessage[] = [];
  executor.on("spontaneous", (message) => spontaneous.push(message));

  // One completed turn so the long-lived loop is live.
  const handle = executor.nextTurn("begin");
  mock.push({ type: "result", subtype: "success", result: "ready" });
  await collectTurn(handle.stream);

  // No active turn now; unrelated activity arrives.
  mock.push({ type: "system", subtype: "init", session_id: "sess-1" });
  mock.push({
    type: "tool_progress",
    tool_use_id: "t1",
    description: "background work",
  } as unknown as LocalSDKMessage);

  await waitFor(
    () => (spontaneous.length >= 2 ? spontaneous : undefined),
    "spontaneous events"
  );
  assert.equal(spontaneous.length, 2);
  assert.equal(spontaneous[0].type, "system");

  await executor.shutdown("test complete");
});

test("task_notification outside a turn emits continuation-turn", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);
  const events: LocalSDKMessage[] = [];
  executor.on("continuation-turn", (message) => events.push(message));

  const handle = executor.nextTurn("start background job");
  mock.push({ type: "result", subtype: "success", result: "started" });
  await collectTurn(handle.stream);

  // Real SDK form: system message with subtype task_notification.
  mock.push({
    type: "system",
    subtype: "task_notification",
    task_id: "t1",
    status: "completed",
    summary: "done",
  } as unknown as LocalSDKMessage);

  await waitFor(() => (events.length > 0 ? events : undefined), "continuation-turn");
  assert.equal(events.length, 1);
  assert.equal((events[0] as { task_id?: string }).task_id, "t1");

  // Legacy form used by the existing team tests: bare type task_notification.
  mock.push({ type: "task_notification", task_id: "t2", status: "completed" } as unknown as LocalSDKMessage);
  await waitFor(() => (events.length >= 2 ? events : undefined), "continuation-turn (bare form)");
  assert.equal(events.length, 2);

  await executor.shutdown("test complete");
});

test("ask_user_question outside a turn emits between-turn-question", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);
  const events: LocalSDKMessage[] = [];
  executor.on("between-turn-question", (message) => events.push(message));

  const handle = executor.nextTurn("begin");
  mock.push({ type: "result", subtype: "success", result: "ready" });
  await collectTurn(handle.stream);

  mock.push({
    type: "ask_user_question",
    uuid: "q1",
    message: { content: [{ type: "text", text: "Continue?" }] },
  } as unknown as LocalSDKMessage);

  await waitFor(() => (events.length > 0 ? events : undefined), "between-turn-question");
  assert.equal(events.length, 1);
  assert.equal((events[0] as { uuid?: string }).uuid, "q1");

  await executor.shutdown("test complete");
});

test("ask_user_question during a turn is routed to the turn stream", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);
  const between: LocalSDKMessage[] = [];
  executor.on("between-turn-question", (message) => between.push(message));

  const handle = executor.nextTurn("choose a file");
  mock.push({
    type: "ask_user_question",
    uuid: "q1",
    message: { content: [{ type: "text", text: "Which file?" }] },
  } as unknown as LocalSDKMessage);
  mock.push({ type: "result", subtype: "success", result: "chosen" });

  const collected: LocalSDKMessage[] = [];
  for await (const message of handle.stream) {
    collected.push(message);
    if (message.type === "ask_user_question") {
      handle.resolveQuestion("q1", { answer: "src/index.ts" });
    }
  }

  assert.equal(collected[0].type, "ask_user_question");
  assert.equal(collected[collected.length - 1].type, "result");
  assert.deepEqual(between, [], "in-turn question must not be emitted as between-turn-question");

  await waitFor(
    () =>
      mock.receivedInputs.some((input) => input.parent_tool_use_id === "q1") ? true : undefined,
    "question resolution should reach the SDK prompt iterable"
  );

  await executor.shutdown("test complete");
});

test("shutdown finishes the queue, drains the stream, and closes the query", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);

  const handle = executor.nextTurn("hello");
  mock.push({ type: "system", subtype: "init", session_id: "s1" });
  mock.push({ type: "result", subtype: "success", result: "done" });
  const messages = await collectTurn(handle.stream);
  assert.equal(messages[messages.length - 1].type, "result");

  await executor.shutdown("app quit");

  assert.equal(executor.isDisposed, true);
  assert.equal(executor.queue.isFinished, true, "cross-turn input queue is finished");
  assert.ok(mock.closed, "underlying query is closed");
  await flush();
  // The loop has fully stopped: pushing after close must not surface anything.
  const spontaneous: LocalSDKMessage[] = [];
  executor.on("spontaneous", (message) => spontaneous.push(message));
  mock.push({ type: "system", subtype: "init", session_id: "s2" });
  await flush(30);
  assert.equal(spontaneous.length, 0);
});

test("shutdown while a turn is active releases the turn stream", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);
  const handle = executor.nextTurn("long task");

  await executor.shutdown("cancelled");

  const collected = await collectTurn(handle.stream);
  assert.equal(collected.length, 0, "no messages are routed to a cancelled turn");
});

test("nextTurn and send after shutdown throw", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);
  await executor.shutdown("done");

  assert.equal(executor.isDisposed, true);
  assert.throws(() => executor.nextTurn("late"), /disposed/);
  assert.throws(() => executor.send("late"), /disposed/);
});

test("turn handle methods guard against a disposed executor", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);
  const handle = executor.nextTurn("hi");
  mock.push({ type: "result", subtype: "success", result: "bye" });
  await collectTurn(handle.stream);

  await executor.shutdown("done");
  assert.throws(() => handle.sendAnswer("tool-1", "sess-1", "a"), /disposed/);
  assert.throws(() => handle.resolveQuestion("tool-1", { a: "b" }), /disposed/);
});

test("shutdown is idempotent", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);
  const handle = executor.nextTurn("hi");
  mock.push({ type: "result", subtype: "success", result: "ok" });
  await collectTurn(handle.stream);

  await executor.shutdown("first");
  await executor.shutdown("second");
  assert.equal(executor.isDisposed, true);
});

test("send() still enqueues into the public cross-turn queue", async () => {
  const mock = createMockQuery();
  const executor = createExecutor(mock);

  executor.send("turn one");
  executor.send("turn two");

  const seen: string[] = [];
  const consumer = (async () => {
    for await (const message of executor.queue) {
      seen.push(message);
    }
  })();

  await executor.shutdown("done");
  await consumer;

  assert.deepEqual(seen, ["turn one", "turn two"]);
});