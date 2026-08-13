import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

test("WorkerSttClient 流意外结束（worker 崩溃/退出）时 stop 返回 error 而非永久挂起", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); });
  const pending = client.stop();
  assert.deepEqual(sent, [{ type: "stop" }]);
  (stdout as any).push(null); // 模拟 worker stdout 关闭 / 进程退出
  assert.deepEqual(await pending, { kind: "error", message: "STT worker 意外退出" });
});

test("WorkerSttClient 收到畸形行时 stop 返回 error 而非 crash 整个 app", async () => {
  const stdout = fakeStdout();
  const client = new WorkerSttClient(stdout, () => {});
  const pending = client.stop();
  (stdout as any).emit("data", "{ not json\n");
  const r = await pending;
  assert.equal(r.kind, "error");
  assert.equal(typeof r.message, "string");
});

test("waitReady 在收到 ready 后 resolve", async () => {
  const stdout = fakeStdout();
  const client = new WorkerSttClient(stdout, () => {});
  const ready = client.waitReady(1000);
  (stdout as any).emit("data", '{"type":"ready"}\n');
  await ready;
});

test("waitReady 在收到 error 消息时 reject", async () => {
  const stdout = fakeStdout();
  const client = new WorkerSttClient(stdout, () => {});
  const ready = client.waitReady(1000);
  (stdout as any).emit("data", '{"type":"error","message":"boom"}\n');
  await assert.rejects(ready, /boom/);
});

test("waitReady 在 worker 意外退出时 reject", async () => {
  const stdout = fakeStdout();
  const client = new WorkerSttClient(stdout, () => {});
  const ready = client.waitReady(1000);
  (stdout as any).push(null);
  await assert.rejects(ready, /STT worker 意外退出/);
});

test("waitReady 超时后 reject", async () => {
  const stdout = fakeStdout();
  const client = new WorkerSttClient(stdout, () => {});
  await assert.rejects(client.waitReady(10), /STT worker 就绪超时/);
});

test("dispose() 强制结束未响应 quit 的子进程（kill 兜底，不残留孤儿）", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: ["pipe", "pipe", "inherit"] });
  const client = new WorkerSttClient(child.stdout!, (cmd) => {
    if (cmd.type === "quit") child.stdin!.write('{"type":"quit"}\n');
  }, child);
  await client.dispose();
  assert.ok(child.exitCode !== null || child.signalCode !== null, "子进程应在 dispose 后退出");
});
