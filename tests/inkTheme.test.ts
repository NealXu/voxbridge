import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTheme, statusColor, THEMES } from "../src/ui/ink/theme.js";

test("theme: resolveTheme(undefined) 返回 default", () => {
  const t = resolveTheme();
  assert.equal(t, THEMES.default);
});

test("theme: resolveTheme 返回对应主题", () => {
  assert.equal(resolveTheme("high-contrast"), THEMES["high-contrast"]);
  assert.equal(resolveTheme("monochrome"), THEMES.monochrome);
});

test("theme: statusColor 根据状态文本选择颜色", () => {
  const t = THEMES.default;
  assert.equal(statusColor(t, "就绪，按 F9 说话"), "green");
  assert.equal(statusColor(t, "🎙 录音中…"), "yellow");
  assert.equal(statusColor(t, "错误: 失败"), "red");
  assert.equal(statusColor(t, "加载模型"), "cyan");
});

test("theme: high-contrast 使用 Bright 变体", () => {
  const t = THEMES["high-contrast"];
  assert.equal(statusColor(t, "就绪"), "greenBright");
  assert.equal(statusColor(t, "录音"), "yellowBright");
  assert.equal(statusColor(t, "错误"), "redBright");
});

test("theme: monochrome 全部返回 white", () => {
  const t = THEMES.monochrome;
  assert.equal(statusColor(t, "就绪"), "white");
  assert.equal(statusColor(t, "录音"), "white");
  assert.equal(statusColor(t, "错误"), "white");
  assert.equal(t.recognition, "white");
});

test("theme: THEMES 包含 3 个主题", () => {
  assert.deepEqual(Object.keys(THEMES).sort(), ["default", "high-contrast", "monochrome"]);
});
