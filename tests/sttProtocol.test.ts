import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { encodeCommand, parseEvent } from "../src/stt/protocol.js";
import { WorkerSttClient } from "../src/stt/workerClient.js";
import type { SttCommand } from "../src/stt/types.js";

/** 模拟 worker stdout：真实 Readable（readline 需要 resume/pause，EventEmitter 不够）。 */
function fakeStdout(): Readable {
  return new Readable({ read() {} });
}

test("encodeCommand 生成单行 JSON", () => {
  assert.equal(encodeCommand({ type: "start" }), '{"type":"start"}\n');
});

test("parseEvent 解析 result 行", () => {
  assert.deepEqual(parseEvent('{"type":"result","text":"你好","duration_ms":800}'), {
    type: "result", text: "你好", duration_ms: 800,
  });
});

test("WorkerSttClient 收到 result 后 stop 返回文本", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  // 第二个构造参数是 send 函数（写入 child.stdin 的编码器），必须传真实函数。
  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); });
  client.start();
  assert.deepEqual(sent, [{ type: "start" }]);
  const pending = client.stop();
  (stdout as any).emit("data", '{"type":"result","text":"改一下","duration_ms":900}\n');
  const r = await pending;
  assert.deepEqual(r, { kind: "text", text: "改一下" });
});

test("WorkerSttClient 收到 noise 后 stop 返回 noise", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); });
  const pending = client.stop();
  assert.deepEqual(sent, [{ type: "stop" }]);
  (stdout as any).emit("data", '{"type":"noise"}\n');
  assert.deepEqual(await pending, { kind: "noise" });
});
