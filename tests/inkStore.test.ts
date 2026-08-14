import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getState, setState, appendOutputLine, subscribe } from "../src/ui/ink/store.js";

describe("ink store", () => {
  beforeEach(() => {
    setState("status", "");
    setState("recognition", "");
    setState("outputLines", []);
  });

  it("getState 返回默认值", () => {
    assert.equal(getState<string>("status"), "");
    assert.deepEqual(getState<string[]>("outputLines"), []);
  });

  it("setState 更新值并通知订阅者", () => {
    let notified = false;
    subscribe(() => { notified = true; });

    setState("status", "就绪");
    assert.equal(getState<string>("status"), "就绪");
    assert.equal(notified, true);
  });

  it("appendOutputLine 追加行并通知", () => {
    let callCount = 0;
    subscribe(() => { callCount++; });

    appendOutputLine("第一行");
    appendOutputLine("第二行");

    const lines = getState<string[]>("outputLines");
    assert.deepEqual(lines, ["第一行", "第二行"]);
    assert.equal(callCount, 2);
  });

  it("subscribe 返回取消函数", () => {
    let count = 0;
    const unsub = subscribe(() => { count++; });

    setState("status", "a");
    assert.equal(count, 1);

    unsub();
    setState("status", "b");
    assert.equal(count, 1);
  });
});
