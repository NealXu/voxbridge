import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getState,
  setState,
  appendOutputLine,
  appendHistory,
  subscribe,
  resetStore,
} from "../src/ui/ink/store.js";

test("store: 初始状态为空", () => {
  resetStore();
  assert.equal(getState("status"), "");
  assert.equal(getState("recognition"), "");
  assert.deepEqual(getState("outputLines"), []);
  assert.deepEqual(getState("history"), []);
  assert.equal(getState("theme"), "default");
});

test("store: setState 触发 subscribe 回调", () => {
  resetStore();
  let calls = 0;
  const unsub = subscribe(() => {
    calls++;
  });
  setState("status", "就绪");
  assert.equal(calls, 1);
  assert.equal(getState("status"), "就绪");
  unsub();
  setState("status", "就绪2");
  assert.equal(calls, 1);
});

test("store: appendOutputLine 累加行", () => {
  resetStore();
  appendOutputLine("line 1");
  appendOutputLine("line 2");
  assert.deepEqual(getState("outputLines"), ["line 1", "line 2"]);
});

test("store: appendHistory 累加并保留时间戳", () => {
  resetStore();
  appendHistory({ prompt: "你好" });
  appendHistory({ prompt: "世界", response: "ok" });
  const h = getState<Array<{ prompt: string; response?: string; timestamp: number }>>("history");
  assert.equal(h.length, 2);
  assert.equal(h[0].prompt, "你好");
  assert.equal(h[1].response, "ok");
  assert.ok(h[1].timestamp > 0);
});

test("store: appendHistory 超过 50 条自动丢弃最旧的", () => {
  resetStore();
  for (let i = 0; i < 60; i++) {
    appendHistory({ prompt: `p-${i}` });
  }
  const h = getState<Array<{ prompt: string }>>("history");
  assert.equal(h.length, 50);
  assert.equal(h[0].prompt, "p-10");
  assert.equal(h[49].prompt, "p-59");
});

test("store: theme 默认 default，可切换到 high-contrast", () => {
  resetStore();
  assert.equal(getState("theme"), "default");
  setState("theme", "high-contrast");
  assert.equal(getState("theme"), "high-contrast");
});

test("store: resetStore 清空所有字段", () => {
  setState("status", "x");
  appendOutputLine("y");
  appendHistory({ prompt: "z" });
  setState("theme", "monochrome");
  resetStore();
  assert.equal(getState("status"), "");
  assert.deepEqual(getState("outputLines"), []);
  assert.deepEqual(getState("history"), []);
  assert.equal(getState("theme"), "default");
});
