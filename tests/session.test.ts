import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentSession } from "../src/session/agentSession.js";

function fakeQuery(messages: any[]) {
  return async function* () {
    for (const m of messages) yield m;
  };
}

test("流式文本触发 onTextDelta，success 返回会话 id", async () => {
  const deltas: string[] = [];
  const session = createAgentSession({
    config: { stt: {} as any, trigger: {} as any, agent: { resume: true, confirmDangerous: true, systemPrompt: "" }, ui: {} as any },
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
  assert.equal(deltas.join(""), "你好世界");
});

test("result 错误子类型返回失败", async () => {
  const session = createAgentSession({
    config: { stt: {} as any, trigger: {} as any, agent: { resume: true, confirmDangerous: true, systemPrompt: "" }, ui: {} as any },
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
