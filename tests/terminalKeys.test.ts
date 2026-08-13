import { test } from "node:test";
import assert from "node:assert/strict";
import { feedTerminalInput } from "../src/trigger/terminalKeys.js";

test("F9 转义序列触发 toggle", () => {
  assert.deepEqual(feedTerminalInput("[18~"), [{ kind: "toggle" }]);
});
test("Esc 触发 cancel", () => {
  assert.deepEqual(feedTerminalInput(""), [{ kind: "cancel" }]);
});
test("普通字符不触发动作", () => {
  assert.deepEqual(feedTerminalInput("hello"), []);
});
test("连续输入解析多个动作", () => {
  assert.deepEqual(feedTerminalInput("[18~"), [
    { kind: "toggle" }, { kind: "cancel" },
  ]);
});
