import test from "node:test";
import assert from "node:assert/strict";
import { processEditKey, renderEditPrompt } from "../src/ui/console.js";

test("Enter 键确认", () => {
  const result = processEditKey("hello", Buffer.from([0x0d]), false);
  assert.deepEqual(result, { buffer: "hello", action: "confirm", hasEdited: false, cursor: 5 });
});

test("Esc 键取消", () => {
  const result = processEditKey("hello", Buffer.from([0x1b]), false);
  assert.deepEqual(result, { buffer: "", action: "cancel", hasEdited: false, cursor: 0 });
});

test("退格键删除字符 - DEL (0x7f)", () => {
  const result = processEditKey("hello", Buffer.from([0x7f]), false);
  assert.deepEqual(result, { buffer: "hell", action: "continue", hasEdited: true, cursor: 4 });
});

test("退格键删除字符 - BS (0x08)", () => {
  const result = processEditKey("hello", Buffer.from([0x08]), false);
  assert.deepEqual(result, { buffer: "hell", action: "continue", hasEdited: true, cursor: 4 });
});

test("退格键对空文本无效果", () => {
  const result = processEditKey("", Buffer.from([0x7f]), false);
  assert.deepEqual(result, { buffer: "", action: "continue", hasEdited: false, cursor: 0 });
});

test("第一次输入替换原有内容", () => {
  const result = processEditKey("hello", Buffer.from("world"), false);
  assert.deepEqual(result, { buffer: "world", action: "continue", hasEdited: true, cursor: 5 });
});

test("后续输入追加到缓冲区", () => {
  const result = processEditKey("hello", Buffer.from(" world"), true, 5);
  assert.deepEqual(result, { buffer: "hello world", action: "continue", hasEdited: true, cursor: 11 });
});

test("中文字符替换", () => {
  const result = processEditKey("旧内容", Buffer.from("新"), false);
  assert.deepEqual(result, { buffer: "新", action: "continue", hasEdited: true, cursor: 1 });
});

test("中文字符追加（已编辑）", () => {
  const result = processEditKey("", Buffer.from("你好"), true, 0);
  assert.deepEqual(result, { buffer: "你好", action: "continue", hasEdited: true, cursor: 2 });
});

test("中文字符首次输入", () => {
  const result = processEditKey("", Buffer.from("你好"), false);
  assert.deepEqual(result, { buffer: "你好", action: "continue", hasEdited: true, cursor: 2 });
});

test("退格键正确删除中文字符", () => {
  const result = processEditKey("你好", Buffer.from([0x7f]), false);
  assert.deepEqual(result, { buffer: "你", action: "continue", hasEdited: true, cursor: 1 });
});

test("空缓冲区时 Enter 确认", () => {
  const result = processEditKey("", Buffer.from([0x0d]), false);
  assert.deepEqual(result, { buffer: "", action: "confirm", hasEdited: false, cursor: 0 });
});

test("Ctrl+U 清空缓冲区", () => {
  const result = processEditKey("hello world", Buffer.from([0x15]), false);
  assert.deepEqual(result, { buffer: "", action: "continue", hasEdited: true, cursor: 0 });
});

test("Ctrl+U 清空后再输入", () => {
  // 清空
  const r1 = processEditKey("旧内容", Buffer.from([0x15]), false);
  assert.deepEqual(r1, { buffer: "", action: "continue", hasEdited: true, cursor: 0 });
  // 清空后输入（hasEdited=true，所以插入）
  const r2 = processEditKey("", Buffer.from("新"), true, 0);
  assert.deepEqual(r2, { buffer: "新", action: "continue", hasEdited: true, cursor: 1 });
});

// ============================================
// 状态机：EDITING 状态的 UI 渲染（两行格式）
// ============================================

test("renderEditPrompt 生成两行格式", () => {
  const output = renderEditPrompt("写一个hello world程序并运行", 10);
  const lines = output.split("\n");
  assert.ok(lines.length >= 2, "应该有多行输出");
  assert.ok(lines[0].includes("写一个hello world程序并运行"), "第一行应包含识别文本");
  assert.ok(lines[1].includes("Enter 发送"), "第二行应包含操作提示");
});

test("renderEditPrompt 使用 ANSI 颜色", () => {
  const output = renderEditPrompt("测试文本", 2);
  assert.ok(output.includes("\x1b["), "应包含 ANSI 转义序列");
});

test("renderEditPrompt 空文本处理", () => {
  const output = renderEditPrompt("", 0);
  assert.ok(output.includes("🎤"), "即使空文本也应显示麦克风图标");
});

test("renderEditPrompt 中文文本处理", () => {
  const output = renderEditPrompt("你好世界", 2);
  assert.ok(output.includes("你好世界"), "应正确显示中文");
});

test("renderEditPrompt 包含光标指示器", () => {
  const output = renderEditPrompt("hello", 2);
  assert.ok(output.includes("🎤"), "应包含麦克风图标");
  // 光标应在文本行内，使用下划线或反色显示
  assert.ok(output.includes("he") && output.includes("llo"), "应包含文本");
});

test("renderEditPrompt 光标在行内显示", () => {
  // 光标在位置 2，应该在 "l" 下方显示光标
  const output = renderEditPrompt("hello", 2);
  // 检查是否有 ANSI 光标定位序列
  assert.ok(output.includes("\x1b["), "应包含 ANSI 序列");
});

test("renderEditPrompt 光标在开头", () => {
  const output = renderEditPrompt("hello", 0);
  // 光标在开头
  assert.ok(output.includes("🎤"), "应包含麦克风图标");
});

test("renderEditPrompt 光标在末尾", () => {
  const output = renderEditPrompt("hello", 5);
  // 光标在末尾
  assert.ok(output.includes("hello"), "应包含完整文本");
});

test("renderEditPrompt 只显示两行", () => {
  const output = renderEditPrompt("hello", 2);
  const lines = output.split("\n");
  // 应该只有两行：文本行 + 提示行
  assert.equal(lines.length, 2, "应该只有两行输出");
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

// ============================================
// 状态机：EDITING 状态的光标移动（方向键）
// ============================================

test("左箭头移动光标位置", () => {
  // 初始状态：buffer="hello", cursor=5（末尾）
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x44]), false, 5);
  assert.deepEqual(result, { buffer: "hello", action: "continue", hasEdited: false, cursor: 4 }, "光标应移动到位置 4");
});

test("右箭头在末尾无效果", () => {
  // 光标已在末尾，右箭头无效
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x43]), false, 5);
  assert.deepEqual(result, { buffer: "hello", action: "continue", hasEdited: false, cursor: 5 }, "光标应保持在位置 5");
});

test("右箭头移动光标向右", () => {
  // 光标在位置 2，右箭头移动到 3
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x43]), false, 2);
  assert.deepEqual(result, { buffer: "hello", action: "continue", hasEdited: false, cursor: 3 }, "光标应移动到位置 3");
});

test("左箭头在开头无效果", () => {
  // 光标已在开头，左箭头无效
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x44]), false, 0);
  assert.deepEqual(result, { buffer: "hello", action: "continue", hasEdited: false, cursor: 0 }, "光标应保持在位置 0");
});

test("退格删除光标前字符（非仅末尾）", () => {
  // 光标在位置 3，删除前一个字符
  const result = processEditKey("hello", Buffer.from([0x7f]), false, 3);
  assert.deepEqual(result, { buffer: "helo", action: "continue", hasEdited: true, cursor: 2 }, "应删除位置 2 的字符，光标移到 2");
});

test("退格在光标为 0 时无效果", () => {
  const result = processEditKey("hello", Buffer.from([0x7f]), false, 0);
  assert.deepEqual(result, { buffer: "hello", action: "continue", hasEdited: false, cursor: 0 }, "光标在开头时退格无效");
});

test("字符插入到光标位置", () => {
  // 光标在位置 2，输入 'X'
  const result = processEditKey("hello", Buffer.from("X"), true, 2);
  assert.deepEqual(result, { buffer: "heXllo", action: "continue", hasEdited: true, cursor: 3 }, "X 应插入到位置 2，光标移到 3");
});

test("中文光标移动正确", () => {
  // "你好世界"，光标从 4 移动到 3
  const result = processEditKey("你好世界", Buffer.from([0x1b, 0x5b, 0x44]), false, 4);
  assert.deepEqual(result, { buffer: "你好世界", action: "continue", hasEdited: false, cursor: 3 }, "中文光标应正确移动");
});

test("中文退格删除正确", () => {
  // "你好世界"，光标在 3（在"世"后、"界"前），删除"世"
  const result = processEditKey("你好世界", Buffer.from([0x7f]), false, 3);
  assert.deepEqual(result, { buffer: "你好界", action: "continue", hasEdited: true, cursor: 2 }, "应删除位置 2 的字符'世'");
});