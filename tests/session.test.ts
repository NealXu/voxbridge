import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentSession } from "../src/session/agentSession.js";
import { ClaudeExecutor } from "../src/executor/claudeExecutor.js";
import type { SDKMessage, SDKUserMessage, Query, Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * Create a mock ClaudeExecutor that yields the given messages.
 */
function createMockExecutor(messages: SDKMessage[]): ClaudeExecutor {
  const mockQuery = ((_params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => {
    return {
      async *[Symbol.asyncIterator]() {
        for (const msg of messages) {
          yield msg;
        }
      },
      close: () => {},
    } as unknown as Query;
  }) as any;
  return new ClaudeExecutor(mockQuery);
}

function makeConfig() {
  return { stt: {} as any, trigger: {} as any, agent: { resume: true, systemPrompt: "", confirmDangerous: false }, ui: {} as any };
}

test("流式文本触发 onTextDelta，success 返回会话 id", async () => {
  const deltas: string[] = [];
  const session = createAgentSession({
    config: makeConfig(),
    cwd: process.cwd(),
    callbacks: { onTextDelta: (t) => deltas.push(t), onToolStart: () => {}, onStatus: () => {} },
    executor: createMockExecutor([
      { type: "system", subtype: "init", session_id: "sess-1" } as unknown as SDKMessage,
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } } } as unknown as SDKMessage,
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "世界" } } } as unknown as SDKMessage,
      { type: "result", subtype: "success", session_id: "sess-1" } as unknown as SDKMessage,
    ]),
  });
  const r = await session.send("你好");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sessionId, "sess-1");
  assert.equal(deltas.join(""), "你好世界");
});

test("result 错误子类型返回失败", async () => {
  const session = createAgentSession({
    config: makeConfig(),
    cwd: process.cwd(),
    callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: () => {} },
    executor: createMockExecutor([
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"] } as unknown as SDKMessage,
    ]),
  });
  const r = await session.send("x");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /boom/);
});

test("tool_use stream_event 触发 onToolStart", async () => {
  const tools: string[] = [];
  const session = createAgentSession({
    config: makeConfig(),
    cwd: process.cwd(),
    callbacks: { onTextDelta: () => {}, onToolStart: (n) => tools.push(n), onStatus: () => {} },
    executor: createMockExecutor([
      { type: "system", subtype: "init", session_id: "sess-1" } as unknown as SDKMessage,
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read" } } } as unknown as SDKMessage,
      { type: "result", subtype: "success", session_id: "sess-1" } as unknown as SDKMessage,
    ]),
  });
  const r = await session.send("x");
  assert.equal(r.ok, true);
  assert.deepEqual(tools, ["Read"]);
});

test("成功时 onStatus 依次为 sending → idle", async () => {
  const statuses: string[] = [];
  const session = createAgentSession({
    config: makeConfig(),
    cwd: process.cwd(),
    callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: (s) => statuses.push(s) },
    executor: createMockExecutor([
      { type: "result", subtype: "success", session_id: "sess-1" } as unknown as SDKMessage,
    ]),
  });
  const r = await session.send("x");
  assert.equal(r.ok, true);
  assert.deepEqual(statuses, ["sending", "idle"]);
});

test("错误结果时 onStatus 依次为 sending → error", async () => {
  const statuses: string[] = [];
  const session = createAgentSession({
    config: makeConfig(),
    cwd: process.cwd(),
    callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: (s) => statuses.push(s) },
    executor: createMockExecutor([
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"] } as unknown as SDKMessage,
    ]),
  });
  const r = await session.send("x");
  assert.equal(r.ok, false);
  assert.deepEqual(statuses, ["sending", "error"]);
});

test("危险工具在 confirmDangerous=true 时触发 onDangerousTool 回调", async () => {
  const dangerousTools: string[] = [];
  const session = createAgentSession({
    config: { ...makeConfig(), agent: { ...makeConfig().agent, confirmDangerous: true } },
    cwd: process.cwd(),
    callbacks: {
      onTextDelta: () => {},
      onToolStart: () => {},
      onStatus: () => {},
      onDangerousTool: (name) => dangerousTools.push(name),
    },
    executor: createMockExecutor([
      { type: "system", subtype: "init", session_id: "sess-1" } as unknown as SDKMessage,
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Write" } } } as unknown as SDKMessage,
      { type: "result", subtype: "success", session_id: "sess-1" } as unknown as SDKMessage,
    ]),
  });
  const r = await session.send("x");
  assert.equal(r.ok, true);
  assert.deepEqual(dangerousTools, ["Write"]);
});

test("安全工具不触发 onDangerousTool 回调", async () => {
  const dangerousTools: string[] = [];
  const session = createAgentSession({
    config: { ...makeConfig(), agent: { ...makeConfig().agent, confirmDangerous: true } },
    cwd: process.cwd(),
    callbacks: {
      onTextDelta: () => {},
      onToolStart: () => {},
      onStatus: () => {},
      onDangerousTool: (name) => dangerousTools.push(name),
    },
    executor: createMockExecutor([
      { type: "system", subtype: "init", session_id: "sess-1" } as unknown as SDKMessage,
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read" } } } as unknown as SDKMessage,
      { type: "result", subtype: "success", session_id: "sess-1" } as unknown as SDKMessage,
    ]),
  });
  const r = await session.send("x");
  assert.equal(r.ok, true);
  assert.deepEqual(dangerousTools, []);
});

test("confirmDangerous=false 时不触发 onDangerousTool", async () => {
  const dangerousTools: string[] = [];
  const session = createAgentSession({
    config: { ...makeConfig(), agent: { ...makeConfig().agent, confirmDangerous: false } },
    cwd: process.cwd(),
    callbacks: {
      onTextDelta: () => {},
      onToolStart: () => {},
      onStatus: () => {},
      onDangerousTool: (name) => dangerousTools.push(name),
    },
    executor: createMockExecutor([
      { type: "system", subtype: "init", session_id: "sess-1" } as unknown as SDKMessage,
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Write" } } } as unknown as SDKMessage,
      { type: "result", subtype: "success", session_id: "sess-1" } as unknown as SDKMessage,
    ]),
  });
  const r = await session.send("x");
  assert.equal(r.ok, true);
  assert.deepEqual(dangerousTools, []);
});
