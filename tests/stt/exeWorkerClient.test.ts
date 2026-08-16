import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { ExeWorkerClient } from "../../src/stt/workers/exeWorkerClient.js";
import type { SttCommand } from "../../src/stt/types.js";
import type { Config } from "../../src/config.js";

/** 模拟 worker stdout */
function fakeStdout(): Readable {
  return new Readable({ read() {} });
}

/** 等待一小段时间让异步回调执行。 */
function tick(ms = 10): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

test("ExeWorkerClient 构造函数接收 exePath 选项", () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  const client = new ExeWorkerClient(stdout, (cmd) => sent.push(cmd), null, { exePath: "test.exe" });
  assert.equal(client.exePath, "test.exe");
});

test("ExeWorkerClient 继承 WorkerSttClient 的所有方法", () => {
  const stdout = fakeStdout();
  const client = new ExeWorkerClient(stdout, () => {}, null, { exePath: "test.exe" });

  // 应该有 SttClient 接口的所有方法
  assert.equal(typeof client.start, "function");
  assert.equal(typeof client.stop, "function");
  assert.equal(typeof client.cancel, "function");
  assert.equal(typeof client.quit, "function");
  assert.equal(typeof client.dispose, "function");
  assert.equal(typeof client.waitReady, "function");
});

test("ExeWorkerClient 收到 result 后 stop 返回文本", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  const client = new ExeWorkerClient(stdout, (cmd) => sent.push(cmd), null, { exePath: "test.exe" });

  client.start();
  assert.deepEqual(sent, [{ type: "start" }]);

  const pending = client.stop();
  (stdout as any).emit("data", '{"type":"result","text":"测试文本","duration_ms":500}\n');
  const r = await pending;
  assert.deepEqual(r, { kind: "text", text: "测试文本" });
});

test("ExeWorkerClient 收到 noise 后 stop 返回 noise", async () => {
  const stdout = fakeStdout();
  const client = new ExeWorkerClient(stdout, () => {}, null, { exePath: "test.exe" });

  const pending = client.stop();
  (stdout as any).emit("data", '{"type":"noise"}\n');
  assert.deepEqual(await pending, { kind: "noise" });
});

test("ExeWorkerClient 流意外结束时 stop 返回 error", async () => {
  const stdout = fakeStdout();
  const client = new ExeWorkerClient(stdout, () => {}, null, { exePath: "test.exe" });

  const pending = client.stop();
  (stdout as any).push(null); // 模拟 worker stdout 关闭
  assert.deepEqual(await pending, { kind: "error", message: "STT worker 意外退出" });
});

test("ExeWorkerClient waitReady 在收到 ready 后 resolve", async () => {
  const stdout = fakeStdout();
  const client = new ExeWorkerClient(stdout, () => {}, null, { exePath: "test.exe" });

  const ready = client.waitReady(1000);
  (stdout as any).emit("data", '{"type":"ready"}\n');
  await ready;
});

test("ExeWorkerClient 支持所有 WorkerSttClientOptions", async () => {
  const stdout = fakeStdout();
  const logs: string[] = [];

  const client = new ExeWorkerClient(
    stdout,
    () => {},
    null,
    {
      exePath: "test.exe",
      onExit: (reason) => logs.push(`exit: ${reason}`),
      onDownloading: (progress, message) => logs.push(`download: ${progress}% ${message}`),
      onStderrLine: (line) => logs.push(`stderr: ${line}`),
    }
  );

  // 测试事件分发
  (stdout as any).emit("data", '{"type":"downloading","progress":0.5,"message":"downloading model"}\n');
  await tick();
  assert.deepEqual(logs, ["download: 0.5% downloading model"]);
});