import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentSession } from "../src/session/agentSession.js";

function fakeQuery(messages: any[]) {
  return async function* () {
    for (const m of messages) yield m;
  };
}

/** Fake queryImpl that records `prompt`/`options` per call for spy assertions. */
function makeCapturingQuery(messages: any[]) {
  const calls: Array<{ prompt: string; options: any }> = [];
  const impl = async function* (params: any) {
    calls.push({ prompt: params.prompt, options: params.options });
    for (const m of messages) yield m;
  };
  return { impl, calls };
}

function makeConfig() {
  return { stt: {} as any, trigger: {} as any, agent: { resume: true, systemPrompt: "" }, ui: {} as any };
}

test("流式文本触发 onTextDelta，success 返回会话 id", async () => {
  const deltas: string[] = [];
  const session = createAgentSession({
    config: makeConfig(),
    cwd: process.cwd(),
    callbacks: { onTextDelta: (t) => deltas.push(t), onToolStart: () => {}, onStatus: () => {} },
    queryImpl: fakeQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "世界" } } },
      { type: "result", subtype: "success", session_id: "sess-1" },
    ]) as any,
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
    queryImpl: fakeQuery([
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"] },
    ]) as any,
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
    queryImpl: fakeQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read" } } },
      { type: "result", subtype: "success", session_id: "sess-1" },
    ]) as any,
  });
  const r = await session.send("x");
  assert.equal(r.ok, true);
  assert.deepEqual(tools, ["Read"]);
});

test("config.agent.resume=true 时第二次 send 携带首个会话 id", async () => {
  const q = makeCapturingQuery([
    { type: "system", subtype: "init", session_id: "sess-1" },
    { type: "result", subtype: "success", session_id: "sess-1" },
  ]);
  const session = createAgentSession({
    config: makeConfig(),
    cwd: process.cwd(),
    callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: () => {} },
    queryImpl: q.impl as any,
  });
  await session.send("first");
  await session.send("second");
  assert.equal(q.calls.length, 2);
  assert.equal(q.calls[0].options.resume, undefined);
  assert.equal(q.calls[1].options.resume, "sess-1");
});

test("reset() 清除 lastSessionId，下次 send 的 resume 为 undefined", async () => {
  const q = makeCapturingQuery([
    { type: "system", subtype: "init", session_id: "sess-1" },
    { type: "result", subtype: "success", session_id: "sess-1" },
  ]);
  const session = createAgentSession({
    config: makeConfig(),
    cwd: process.cwd(),
    callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: () => {} },
    queryImpl: q.impl as any,
  });
  await session.send("first");
  session.reset();
  await session.send("second");
  assert.equal(q.calls.length, 2);
  assert.equal(q.calls[0].options.resume, undefined);
  assert.equal(q.calls[1].options.resume, undefined);
});

test("成功时 onStatus 依次为 sending → idle", async () => {
  const statuses: string[] = [];
  const session = createAgentSession({
    config: makeConfig(),
    cwd: process.cwd(),
    callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: (s) => statuses.push(s) },
    queryImpl: fakeQuery([
      { type: "result", subtype: "success", session_id: "sess-1" },
    ]) as any,
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
    queryImpl: fakeQuery([
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"] },
    ]) as any,
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
    queryImpl: fakeQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Write" } } },
      { type: "result", subtype: "success", session_id: "sess-1" },
    ]) as any,
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
    queryImpl: fakeQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read" } } },
      { type: "result", subtype: "success", session_id: "sess-1" },
    ]) as any,
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
    queryImpl: fakeQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Write" } } },
      { type: "result", subtype: "success", session_id: "sess-1" },
    ]) as any,
  });
  const r = await session.send("x");
  assert.equal(r.ok, true);
  assert.deepEqual(dangerousTools, []);
});
