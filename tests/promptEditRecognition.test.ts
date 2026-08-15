import test from "node:test";
import assert from "node:assert/strict";
import { processEditKey } from "../src/ui/console.js";

test("Enter 键确认", () => {
  const result = processEditKey("hello", Buffer.from([0x0d]), false);
  assert.deepEqual(result, { buffer: "hello", action: "confirm", hasEdited: false });
});

test("Esc 键取消", () => {
  const result = processEditKey("hello", Buffer.from([0x1b]), false);
  assert.deepEqual(result, { buffer: "", action: "cancel", hasEdited: false });
});

test("退格键删除字符 - DEL (0x7f)", () => {
  const result = processEditKey("hello", Buffer.from([0x7f]), false);
  assert.deepEqual(result, { buffer: "hell", action: "continue", hasEdited: true });
});

test("退格键删除字符 - BS (0x08)", () => {
  const result = processEditKey("hello", Buffer.from([0x08]), false);
  assert.deepEqual(result, { buffer: "hell", action: "continue", hasEdited: true });
});

test("退格键对空文本无效果", () => {
  const result = processEditKey("", Buffer.from([0x7f]), false);
  assert.deepEqual(result, { buffer: "", action: "continue", hasEdited: false });
});

test("第一次输入替换原有内容", () => {
  const result = processEditKey("hello", Buffer.from("world"), false);
  assert.deepEqual(result, { buffer: "world", action: "continue", hasEdited: true });
});

test("后续输入追加到缓冲区", () => {
  const result = processEditKey("hello", Buffer.from(" world"), true);
  assert.deepEqual(result, { buffer: "hello world", action: "continue", hasEdited: true });
});

test("中文字符替换", () => {
  const result = processEditKey("旧内容", Buffer.from("新"), false);
  assert.deepEqual(result, { buffer: "新", action: "continue", hasEdited: true });
});

test("中文字符追加（已编辑）", () => {
  const result = processEditKey("", Buffer.from("你好"), true);
  assert.deepEqual(result, { buffer: "你好", action: "continue", hasEdited: true });
});

test("中文字符首次输入", () => {
  const result = processEditKey("", Buffer.from("你好"), false);
  assert.deepEqual(result, { buffer: "你好", action: "continue", hasEdited: true });
});

test("退格键正确删除中文字符", () => {
  const result = processEditKey("你好", Buffer.from([0x7f]), false);
  assert.deepEqual(result, { buffer: "你", action: "continue", hasEdited: true });
});

test("空缓冲区时 Enter 确认", () => {
  const result = processEditKey("", Buffer.from([0x0d]), false);
  assert.deepEqual(result, { buffer: "", action: "confirm", hasEdited: false });
});

test("Ctrl+U 清空缓冲区", () => {
  const result = processEditKey("hello world", Buffer.from([0x15]), false);
  assert.deepEqual(result, { buffer: "", action: "continue", hasEdited: true });
});

test("Ctrl+U 清空后再输入", () => {
  // 清空
  const r1 = processEditKey("旧内容", Buffer.from([0x15]), false);
  assert.deepEqual(r1, { buffer: "", action: "continue", hasEdited: true });
  // 清空后输入（hasEdited=true，所以追加）
  const r2 = processEditKey("", Buffer.from("新"), true);
  assert.deepEqual(r2, { buffer: "新", action: "continue", hasEdited: true });
});

// ============================================
// 状态机：EDITING 状态的 UI 渲染（两行格式）
// ============================================

import { renderEditPrompt } from "../src/ui/console.js";

test("renderEditPrompt 生成两行格式", () => {
  const output = renderEditPrompt("写一个hello world程序并运行");
  const lines = output.split("\n");
  assert.ok(lines.length >= 2, "应该有两行输出");
  assert.ok(lines[0].includes("写一个hello world程序并运行"), "第一行应包含识别文本");
  assert.ok(lines[1].includes("Enter 发送"), "第二行应包含操作提示");
  assert.ok(lines[1].includes("Esc 取消"), "第二行应包含取消提示");
  assert.ok(lines[1].includes("Ctrl+U 清空"), "第二行应包含清空提示");
});

test("renderEditPrompt 使用 ANSI 颜色", () => {
  const output = renderEditPrompt("测试文本");
  assert.ok(output.includes("\x1b["), "应包含 ANSI 转义序列");
});

test("renderEditPrompt 空文本处理", () => {
  const output = renderEditPrompt("");
  assert.ok(output.includes("🎤"), "即使空文本也应显示麦克风图标");
});

test("renderEditPrompt 中文文本处理", () => {
  const output = renderEditPrompt("你好世界");
  assert.ok(output.includes("你好世界"), "应正确显示中文");
});

// ============================================
// 状态机：EDITING 状态的键盘输入 - 方向键不应触发取消
// ============================================

test("方向键（上）不应触发取消", () => {
  // 上箭头: ESC [ A = 1b 5b 41
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x41]), false);
  assert.deepEqual(result.action, "continue", "上箭头应继续编辑，不取消");
});

test("方向键（下）不应触发取消", () => {
  // 下箭头: ESC [ B = 1b 5b 42
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x42]), false);
  assert.deepEqual(result.action, "continue", "下箭头应继续编辑，不取消");
});

test("方向键（左）不应触发取消", () => {
  // 左箭头: ESC [ D = 1b 5b 44
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x44]), false);
  assert.deepEqual(result.action, "continue", "左箭头应继续编辑，不取消");
});

test("方向键（右）不应触发取消", () => {
  // 右箭头: ESC [ C = 1b 5b 43
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x43]), false);
  assert.deepEqual(result.action, "continue", "右箭头应继续编辑，不取消");
});

test("单字节 ESC 仍应取消", () => {
  // 单独的 ESC 键 = 1b
  const result = processEditKey("hello", Buffer.from([0x1b]), false);
  assert.deepEqual(result.action, "cancel", "单字节 ESC 应取消");
});

test("其他 ESC 序列（如 F1-F12）应忽略", () => {
  // F1: ESC O P = 1b 4f 50
  const result = processEditKey("hello", Buffer.from([0x1b, 0x4f, 0x50]), false);
  assert.deepEqual(result.action, "continue", "F1 功能键应忽略");
});

test("Home 键应忽略", () => {
  // Home: ESC [ H 或 ESC [ 1 ~ = 1b 5b 31 7e
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x48]), false);
  assert.deepEqual(result.action, "continue", "Home 键应忽略");
});

test("End 键应忽略", () => {
  // End: ESC [ F 或 ESC [ 4 ~
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x46]), false);
  assert.deepEqual(result.action, "continue", "End 键应忽略");
});