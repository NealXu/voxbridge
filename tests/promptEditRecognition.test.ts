import test from "node:test";
import assert from "node:assert/strict";
import { processEditKey, renderEditPrompt, getDisplayWidth } from "../src/ui/console.js";

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

test("第一次输入应插入到光标位置（而非替换）", () => {
  // 新行为：第一次输入也插入到光标位置，符合用户直觉
  // 如果用户想替换整个文本，可以先按 Ctrl+U 清空
  const result = processEditKey("hello", Buffer.from("X"), false, 5);
  assert.deepEqual(result, { buffer: "helloX", action: "continue", hasEdited: true, cursor: 6 }, "第一次输入应追加到末尾");
});

test("第一次输入在开头应插入到开头", () => {
  const result = processEditKey("hello", Buffer.from("X"), false, 0);
  assert.deepEqual(result, { buffer: "Xhello", action: "continue", hasEdited: true, cursor: 1 }, "在开头输入应插入到开头");
});

test("后续输入追加到缓冲区", () => {
  const result = processEditKey("hello", Buffer.from(" world"), true, 5);
  assert.deepEqual(result, { buffer: "hello world", action: "continue", hasEdited: true, cursor: 11 });
});

test("中文字符插入（光标在末尾）", () => {
  const result = processEditKey("旧内容", Buffer.from("新"), false, 3);
  assert.deepEqual(result, { buffer: "旧内容新", action: "continue", hasEdited: true, cursor: 4 }, "应在末尾插入");
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
  // 光标在位置 2，应该在 "l" 位置显示光标
  const output = renderEditPrompt("hello", 2);
  // 检查是否有 ANSI 光标定位序列
  assert.ok(output.includes("\x1b["), "应包含 ANSI 序列");
  // 光标应使用相对定位（上移两行），而非绝对定位到行 1
  assert.ok(output.includes("\x1b[2A"), "应使用上移两行定位到文本行");
});

test("renderEditPrompt 光标定位使用相对移动", () => {
  const output = renderEditPrompt("hello", 2);
  // 应该先输出两行，然后光标相对移动
  // 使用 \x1b[2A 上移两行（文本行 + 提示行），然后 \x1b[${col}G 移动到列
  assert.ok(output.includes("\x1b[2A"), "应使用上移两行定位到文本行");
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

test("renderEditPrompt 只显示两行可见内容", () => {
  const output = renderEditPrompt("hello", 2);
  const lines = output.split("\n");
  // 应该有三个部分（文本行 + 提示行 + 光标序列）
  // 但可见内容只有两行
  // 第一行包含绿色文本，第二行包含灰色提示，第三行是纯 ANSI 序列
  assert.ok(lines.length >= 2, "应该至少有两行");
  assert.ok(lines[0].includes("hello"), "第一行应包含文本");
  assert.ok(lines[1].includes("Enter"), "第二行应包含提示");
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
  // 修复：方向键应该设置 hasEdited=true，这样后续输入会插入而非替换
  assert.deepEqual(result, { buffer: "hello", action: "continue", hasEdited: true, cursor: 4 }, "光标应移动到位置 4，且 hasEdited 应为 true");
});

test("右箭头在末尾无效果", () => {
  // 光标已在末尾，右箭头无效，但 hasEdited 应变为 true（用户主动操作了光标）
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x43]), false, 5);
  assert.deepEqual(result, { buffer: "hello", action: "continue", hasEdited: true, cursor: 5 }, "光标应保持在位置 5，hasEdited 应为 true");
});

test("右箭头移动光标向右", () => {
  // 光标在位置 2，右箭头移动到 3
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x43]), false, 2);
  assert.deepEqual(result, { buffer: "hello", action: "continue", hasEdited: true, cursor: 3 }, "光标应移动到位置 3，hasEdited 应为 true");
});

test("左箭头在开头无效果", () => {
  // 光标已在开头，左箭头无效，但 hasEdited 应变为 true（用户主动操作了光标）
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x44]), false, 0);
  assert.deepEqual(result, { buffer: "hello", action: "continue", hasEdited: true, cursor: 0 }, "光标应保持在位置 0，hasEdited 应为 true");
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
  assert.deepEqual(result, { buffer: "你好世界", action: "continue", hasEdited: true, cursor: 3 }, "中文光标应正确移动，hasEdited 应为 true");
});

test("中文退格删除正确", () => {
  // "你好世界"，光标在 3（在"世"后、"界"前），删除"世"
  const result = processEditKey("你好世界", Buffer.from([0x7f]), false, 3);
  assert.deepEqual(result, { buffer: "你好界", action: "continue", hasEdited: true, cursor: 2 }, "应删除位置 2 的字符'世'");
});

// ============================================
// 光标移动范围约束测试
// ============================================

test("右箭头不应超过文本长度", () => {
  // "hello" 长度 5，光标从 5 右移应保持 5
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x43]), false, 5);
  assert.equal(result.cursor, 5, "光标不应超过文本长度");
});

test("左箭头不应小于 0", () => {
  // 光标从 0 左移应保持 0
  const result = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x44]), false, 0);
  assert.equal(result.cursor, 0, "光标不应小于 0");
});

test("空文本时光标始终为 0", () => {
  const result = processEditKey("", Buffer.from([0x1b, 0x5b, 0x44]), false, 0);
  assert.equal(result.cursor, 0, "空文本光标应为 0");
});

test("中文字符右箭头正确移动", () => {
  // "你好世界" 光标从 2 右移到 3
  const result = processEditKey("你好世界", Buffer.from([0x1b, 0x5b, 0x43]), false, 2);
  assert.equal(result.cursor, 3, "中文光标应正确右移");
  assert.equal(result.hasEdited, true, "方向键应设置 hasEdited=true");
});

test("中文字符左箭头正确移动", () => {
  // "你好世界" 光标从 2 左移到 1
  const result = processEditKey("你好世界", Buffer.from([0x1b, 0x5b, 0x44]), false, 2);
  assert.equal(result.cursor, 1, "中文光标应正确左移");
  assert.equal(result.hasEdited, true, "方向键应设置 hasEdited=true");
});

// ============================================
// 核心 Bug 修复：方向键移动后输入应插入而非替换
// ============================================

test("【BUG FIX】方向键左移后输入应在光标位置插入，而非替换整个 buffer", () => {
  // 场景：用户看到 "你好，世界。" 光标在末尾（位置 7）
  // 步骤 1：按左箭头 2 次，光标移到 "。" 前面（位置 5）
  const step1 = processEditKey("你好，世界。", Buffer.from([0x1b, 0x5b, 0x44]), false, 7);
  assert.equal(step1.cursor, 6, "左箭头一次，光标到 6");
  const step2 = processEditKey(step1.buffer, Buffer.from([0x1b, 0x5b, 0x44]), step1.hasEdited, step1.cursor);
  assert.equal(step2.cursor, 5, "左箭头两次，光标到 5");

  // 步骤 2：输入 "的"
  const step3 = processEditKey(step2.buffer, Buffer.from("的"), step2.hasEdited, step2.cursor);
  // 期望：在光标位置 5 插入 "的"，而不是替换整个 buffer
  assert.equal(step3.buffer, "你好，世界的。", "应在位置 5 插入'的'，而非替换整个 buffer");
  assert.equal(step3.cursor, 6, "光标应在插入字符之后");
});

test("【BUG FIX】方向键右移后输入应插入", () => {
  // 光标在位置 2（"he" 之后），右移到 3，然后输入 "X"
  const step1 = processEditKey("hello", Buffer.from([0x1b, 0x5b, 0x43]), false, 2);
  assert.equal(step1.hasEdited, true, "方向键应设置 hasEdited");
  const step2 = processEditKey(step1.buffer, Buffer.from("X"), step1.hasEdited, step1.cursor);
  assert.equal(step2.buffer, "helXlo", "应在位置 3 插入 X");
});

test("【BUG FIX】用户的原始场景：在句号前插入'的'", () => {
  // 显示 1："你好，世界。" 光标在末尾（位置 6）
  // 用左箭头把光标移到 "。" 前面（位置 5）
  const buffer = "你好，世界。";
  const atEnd = { buffer, cursor: buffer.length, hasEdited: false };

  // 左箭头移到 "。" 前（位置 5）
  const moved = processEditKey(atEnd.buffer, Buffer.from([0x1b, 0x5b, 0x44]), atEnd.hasEdited, atEnd.cursor);
  assert.equal(moved.cursor, 5, "光标移到位置 5（'。'前）");
  assert.equal(moved.hasEdited, true, "hasEdited 应为 true");

  // 输入 "的" → 期望 "你好，世界的。"
  const typed = processEditKey(moved.buffer, Buffer.from("的"), moved.hasEdited, moved.cursor);
  assert.equal(typed.buffer, "你好，世界的。", "应在光标位置插入'的'");
  assert.equal(typed.cursor, 6, "光标应在'的'之后");
});

test("【复现 Bug】介绍蜡笔小新场景：光标在末尾直接输入应追加", () => {
  // 用户看到 "介绍蜡笔小新。" 光标在末尾
  // 直接输入 "的"，应该追加到末尾，而非替换
  const buffer = "介绍蜡笔小新。";
  const result = processEditKey(buffer, Buffer.from("的"), false, buffer.length);
  // 新行为：追加到末尾
  assert.equal(result.buffer, "介绍蜡笔小新。的", "第一次输入应追加到末尾");
});

test("【复现 Bug】介绍蜡笔小新场景：左箭头后输入应插入", () => {
  // 用户看到 "介绍蜡笔小新。" 光标在末尾（位置 7）
  // 按左箭头 1 次，光标到位置 6（在 "。" 前面）
  // 输入 "的"，期望 "介绍蜡笔小新的。"
  const buffer = "介绍蜡笔小新。";

  // 初始状态：光标在末尾
  const initial = { buffer, cursor: buffer.length, hasEdited: false };
  assert.equal(initial.cursor, 7, "初始光标在位置 7（末尾）");

  // 左箭头 1 次
  const afterArrow = processEditKey(initial.buffer, Buffer.from([0x1b, 0x5b, 0x44]), initial.hasEdited, initial.cursor);
  assert.equal(afterArrow.cursor, 6, "左箭头后光标到位置 6");
  assert.equal(afterArrow.hasEdited, true, "hasEdited 应为 true");

  // 输入 "的"
  const afterType = processEditKey(afterArrow.buffer, Buffer.from("的"), afterArrow.hasEdited, afterArrow.cursor);
  assert.equal(afterType.buffer, "介绍蜡笔小新的。", "应在位置 6 插入'的'");
  assert.equal(afterType.cursor, 7, "光标应在'的'之后");
});

test("其他终端箭头键格式：ESC O D (左箭头)", () => {
  // 某些终端发送 ESC O D 而不是 ESC [ D
  const buffer = "介绍蜡笔小新。";
  const result = processEditKey(buffer, Buffer.from([0x1b, 0x4f, 0x44]), false, 7);
  // 应该识别为左箭头，设置 hasEdited=true
  assert.equal(result.hasEdited, true, "ESC O D 应设置 hasEdited=true");
  assert.equal(result.cursor, 6, "光标应左移");
});

test("其他终端箭头键格式：ESC O C (右箭头)", () => {
  // 某些终端发送 ESC O C 而不是 ESC [ C
  const buffer = "介绍蜡笔小新。";
  const result = processEditKey(buffer, Buffer.from([0x1b, 0x4f, 0x43]), false, 6);
  assert.equal(result.hasEdited, true, "ESC O C 应设置 hasEdited=true");
  assert.equal(result.cursor, 7, "光标应右移");
});

// ============================================
// 光标列计算测试（考虑显示宽度）
// ============================================

test("calculateCursorCol 英文字符宽度为 1", () => {
  // 假设前缀 "🎤 " = 3 显示宽度，英文各字符宽度 1
  // "hello" 光标在 2，列应为 3 + 2 = 5
  // 实际计算需要考虑 emoji 宽度
  const prefixWidth = 3; // "🎤 " (emoji=2 + space=1)
  const textBeforeCursor = "he"; // 2 characters = 2 width
  const expectedCol = prefixWidth + textBeforeCursor.length + 1; // +1 for ANSI 1-indexed
  assert.equal(expectedCol, 6, "英文光标列计算");
});

test("calculateCursorCol 中文字符宽度为 2", () => {
  // "你好世界" 光标在 2（"你好" 后）
  // 前缀 "🎤 " = 3 显示宽度
  // "你好" = 2 * 2 = 4 显示宽度
  // 列 = 3 + 4 + 1 = 8（ANSI 1-indexed）
  const prefixWidth = 3;
  const chineseCharWidth = 2;
  const expectedCol = prefixWidth + 2 * chineseCharWidth + 1;
  assert.equal(expectedCol, 8, "中文光标列计算");
});

// ============================================
// getDisplayWidth 显示宽度计算测试
// ============================================

test("getDisplayWidth ASCII 字符宽度为 1", () => {
  assert.equal(getDisplayWidth("hello"), 5, "ASCII 字符宽度应为 1");
});

test("getDisplayWidth 中文字符宽度为 2", () => {
  assert.equal(getDisplayWidth("你好"), 4, "中文字符宽度应为 2");
});

test("getDisplayWidth 混合字符计算正确", () => {
  assert.equal(getDisplayWidth("你a好b"), 6, "混合字符 '你a好b' 应为 2+1+2+1=6");
});

test("getDisplayWidth 空字符串为 0", () => {
  assert.equal(getDisplayWidth(""), 0, "空字符串宽度应为 0");
});

test("getDisplayWidth 表情符号宽度为 2", () => {
  // 大多数终端中 emoji 显示宽度为 2
  assert.equal(getDisplayWidth("🎉"), 2, "emoji 宽度应为 2");
});

// ============================================
// Ctrl+C 退出系统测试
// ============================================

test("Ctrl+C (ETX 0x03) 应退出系统", () => {
  // 在 raw mode 下，Ctrl+C 发送 ETX (0x03) 而非 SIGINT
  // 编辑界面按 Ctrl+C 应该退出整个系统，而不是取消编辑
  const result = processEditKey("hello", Buffer.from([0x03]), false);
  assert.deepEqual(result, { buffer: "", action: "exit", hasEdited: false, cursor: 0 }, "Ctrl+C 应退出系统");
});

test("Ctrl+C 在空缓冲区时也应退出系统", () => {
  const result = processEditKey("", Buffer.from([0x03]), false);
  assert.deepEqual(result, { buffer: "", action: "exit", hasEdited: false, cursor: 0 }, "Ctrl+C 在空缓冲区时应退出系统");
});

test("Ctrl+C 在光标非末尾时应退出系统", () => {
  const result = processEditKey("hello", Buffer.from([0x03]), false, 2);
  assert.deepEqual(result, { buffer: "", action: "exit", hasEdited: false, cursor: 0 }, "Ctrl+C 应退出系统，忽略光标位置");
});