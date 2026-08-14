import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { WorkerSttClient } from "../src/stt/workerClient.js";
import type { SttCommand } from "../src/stt/types.js";

/** 模拟 worker stdout：真实 Readable（readline 需要 resume/pause，EventEmitter 不够）。 */
function fakeStdout(): Readable {
  return new Readable({ read() {} });
}

/** 等待一小段时间让异步回调执行。 */
function tick(ms = 10): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

test("WorkerSttClient 支持可选 onExit 回调", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  let exitCalled = false;
  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); }, undefined, { onExit: () => { exitCalled = true; } });
  // 模拟 worker 崩溃（stdout 关闭）
  (stdout as any).push(null);
  await tick();
  assert.ok(exitCalled, "onExit 回调应在 worker 退出时被调用");
});

test("WorkerSttClient 的 onExit 在正常 dispose 后不触发", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  let exitCalled = false;
  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); }, undefined, { onExit: () => { exitCalled = true; } });
  await client.dispose();
  // dispose 后 exited=true，onExit 不应再触发（避免重复回调）
  (stdout as any).push(null);
  await tick();
  assert.ok(!exitCalled, "dispose 后的 stdout end 不应再触发 onExit");
});

test("WorkerSttClient 的 onExit 在 ready 前的意外退出时触发", async () => {
  const stdout = fakeStdout();
  let exitCalled = false;
  let exitReason: string | null = null;
  const client = new WorkerSttClient(stdout, () => {}, undefined, {
    onExit: (reason) => {
      exitCalled = true;
      exitReason = reason;
    }
  });
  // 模拟 worker 在 ready 前崩溃
  (stdout as any).push(null);
  await tick();
  assert.ok(exitCalled, "onExit 应在 worker 意外退出时触发");
  assert.ok(exitReason?.includes("意外退出"), "退出原因应包含 '意外退出'");
});

test("WorkerSttClient 的 onExit 在 ready 后的意外退出时触发", async () => {
  const stdout = fakeStdout();
  let exitCalled = false;
  const client = new WorkerSttClient(stdout, () => {}, undefined, {
    onExit: () => { exitCalled = true; }
  });
  // 先发送 ready
  (stdout as any).emit("data", '{"type":"ready"}\n');
  await client.waitReady(1000);
  // 然后模拟崩溃
  (stdout as any).push(null);
  await tick();
  assert.ok(exitCalled, "onExit 应在 ready 后的 worker 意外退出时触发");
});

test("WorkerSttClient exited 标志在 dispose 后为 true，可判断是否需要重启", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); });
  assert.ok(!client.exited, "初始状态 exited 应为 false");
  await client.dispose();
  assert.ok(client.exited, "dispose 后 exited 应为 true");
});

// ============ 崩溃恢复逻辑测试 ============

test("崩溃恢复：单次崩溃后自动重启", async () => {
  // 模拟创建 worker 的工厂函数
  let spawnCount = 0;
  const createdClients: WorkerSttClient[] = [];

  const createClient = () => {
    spawnCount++;
    const stdout = fakeStdout();
    const client = new WorkerSttClient(stdout, () => {}, undefined, {
      onExit: handleWorkerExit
    });
    createdClients.push(client);
    return { client, stdout };
  };

  let currentClient: WorkerSttClient | null = null;
  let currentStdout: Readable | null = null;
  let consecutiveCrashes = 0;
  let shouldExit = false;
  let restarted = false;

  function handleWorkerExit(reason: string) {
    if (currentClient?.exited && shouldExit) return; // 防止重复处理
    consecutiveCrashes++;
    // 模拟重启逻辑
    if (consecutiveCrashes < 3) {
      restarted = true;
      const next = createClient();
      currentClient = next.client;
      currentStdout = next.stdout;
      // 新客户端成功 ready 后重置计数器
      (currentStdout as any).emit("data", '{"type":"ready"}\n');
      consecutiveCrashes = 0;
    } else {
      shouldExit = true;
    }
  }

  // 初始创建
  const initial = createClient();
  currentClient = initial.client;
  currentStdout = initial.stdout;

  // 模拟第一次崩溃
  (currentStdout as any).push(null);
  await tick();

  assert.equal(spawnCount, 2, "应创建新的 worker 实例");
  assert.ok(restarted, "应触发重启");
  assert.ok(!shouldExit, "单次崩溃不应退出应用");
});

test("崩溃恢复：连续 3 次崩溃后退出应用", async () => {
  let spawnCount = 0;
  let consecutiveCrashes = 0;
  let exitCalled = false;
  let exitMessage = "";

  const createClient = () => {
    spawnCount++;
    const stdout = fakeStdout();
    const client = new WorkerSttClient(stdout, () => {}, undefined, {
      onExit: (reason) => handleWorkerExit(reason, stdout)
    });
    return { client, stdout };
  };

  function handleWorkerExit(reason: string, stdout: Readable) {
    consecutiveCrashes++;
    if (consecutiveCrashes >= 3) {
      exitCalled = true;
      exitMessage = reason;
    } else {
      // 模拟立即崩溃（不发送 ready）
      const next = createClient();
      // 立即让它崩溃（模拟连续崩溃）
      setTimeout(() => (next.stdout as any).push(null), 0);
    }
  }

  // 初始创建
  const initial = createClient();

  // 模拟第一次崩溃
  (initial.stdout as any).push(null);
  await tick(50);

  assert.ok(exitCalled, "连续 3 次崩溃应触发退出");
  assert.ok(exitMessage.includes("意外退出"), "退出消息应包含错误原因");
  assert.equal(spawnCount, 3, "应尝试创建 3 个 worker");
});

test("崩溃恢复：成功 ready 后重置崩溃计数器", async () => {
  let consecutiveCrashes = 0;
  let successfulRecovery = false;

  const createClient = () => {
    const stdout = fakeStdout();
    const client = new WorkerSttClient(stdout, () => {}, undefined, {
      onExit: () => handleWorkerExit(stdout)
    });
    return { client, stdout };
  };

  function handleWorkerExit(stdout: Readable) {
    consecutiveCrashes++;
    if (consecutiveCrashes < 3) {
      const next = createClient();
      // 新客户端成功 ready
      (next.stdout as any).emit("data", '{"type":"ready"}\n');
      // 成功恢复后重置计数器
      consecutiveCrashes = 0;
      successfulRecovery = true;
    }
  }

  // 初始创建
  const initial = createClient();
  // 让它 ready
  (initial.stdout as any).emit("data", '{"type":"ready"}\n');

  // 模拟崩溃
  (initial.stdout as any).push(null);
  await tick();

  assert.ok(successfulRecovery, "应成功恢复");
  assert.equal(consecutiveCrashes, 0, "计数器应被重置");
});