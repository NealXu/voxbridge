import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { WorkerSttClient } from "../src/stt/workerClient.js";
import type { SttCommand } from "../src/stt/types.js";

function fakeStdout(): Readable {
  return new Readable({ read() {} });
}

function tick(ms = 10): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

test("wake 事件分发：onWake 回调在收到 {type:wake} 时被调用", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  let wakeCalls = 0;

  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); }, undefined, {
    onWake: () => { wakeCalls++; },
  });

  // 模拟 worker 发送 wake 事件
  stdout.push('{"type":"wake","phrase":"你好小助","heard":"你好小助"}\n');
  await tick();

  assert.equal(wakeCalls, 1);
});

test("wake 事件分发：onWake 可通过 onWake() 方法后绑定", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  let wakeCalls = 0;

  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); });

  // 后绑定 wake 回调
  client.onWake(() => { wakeCalls++; });

  stdout.push('{"type":"wake"}\n');
  await tick();

  assert.equal(wakeCalls, 1);
});

test("wake 事件分发：offWake 移除回调", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  let wakeCalls = 0;
  const handler = () => { wakeCalls++; };

  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); });
  client.onWake(handler);
  client.offWake(handler);

  stdout.push('{"type":"wake"}\n');
  await tick();

  assert.equal(wakeCalls, 0);
});

test("wake 事件分发：多次 wake 事件累计触发", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  let wakeCalls = 0;

  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); }, undefined, {
    onWake: () => { wakeCalls++; },
  });

  stdout.push('{"type":"wake"}\n');
  stdout.push('{"type":"wake"}\n');
  stdout.push('{"type":"wake"}\n');
  await tick();

  assert.equal(wakeCalls, 3);
});

test("wake 事件分发：onWake 回调抛错不影响后续事件", async () => {
  const stdout = fakeStdout();
  const sent: SttCommand[] = [];
  let secondWakeCalls = 0;
  let first = true;

  const client = new WorkerSttClient(stdout, (cmd) => { sent.push(cmd); }, undefined, {
    onWake: () => {
      if (first) {
        first = false;
        throw new Error("boom");
      }
      secondWakeCalls++;
    },
  });

  stdout.push('{"type":"wake"}\n');
  await tick();
  stdout.push('{"type":"wake"}\n');
  await tick();

  assert.equal(secondWakeCalls, 1);
});
