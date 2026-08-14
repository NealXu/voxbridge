import test from "node:test";
import assert from "node:assert/strict";
import { processEditKey } from "../src/ui/console.js";

test("Enter 键确认", () => {
  const result = processEditKey("hello", Buffer.from([0x0d])); // Enter = CR
  assert.deepEqual(result, { buffer: "hello", action: "confirm" });
});

test("Esc 键取消", () => {
  const result = processEditKey("hello", Buffer.from([0x1b])); // ESC
  assert.deepEqual(result, { buffer: "", action: "cancel" });
});

test("退格键删除字符 - DEL (0x7f)", () => {
  const result = processEditKey("hello", Buffer.from([0x7f]));
  assert.deepEqual(result, { buffer: "hell", action: "continue" });
});

test("退格键删除字符 - BS (0x08)", () => {
  const result = processEditKey("hello", Buffer.from([0x08]));
  assert.deepEqual(result, { buffer: "hell", action: "continue" });
});

test("退格键对空文本无效果", () => {
  const result = processEditKey("", Buffer.from([0x7f]));
  assert.deepEqual(result, { buffer: "", action: "continue" });
});

test("普通字符追加到缓冲区", () => {
  const result = processEditKey("hello", Buffer.from(" world"));
  assert.deepEqual(result, { buffer: "hello world", action: "continue" });
});

test("中文字符追加", () => {
  const result = processEditKey("", Buffer.from("你好"));
  assert.deepEqual(result, { buffer: "你好", action: "continue" });
});

test("退格键正确删除中文字符", () => {
  const result = processEditKey("你好", Buffer.from([0x7f]));
  assert.deepEqual(result, { buffer: "你", action: "continue" });
});

test("空缓冲区时 Enter 确认", () => {
  const result = processEditKey("", Buffer.from([0x0d]));
  assert.deepEqual(result, { buffer: "", action: "confirm" });
});