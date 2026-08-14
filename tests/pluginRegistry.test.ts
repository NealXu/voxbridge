import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlugin } from "../src/stt/pluginRegistry.js";
import type { SttPlugin } from "../src/stt/pluginTypes.js";

test("createPlugin 创建 whisper 插件", () => {
  const plugin = createPlugin("whisper", { model: "large-v3", model_dir: "/tmp", language: "zh", python_path: "py" });
  assert.ok(plugin);
  assert.equal(typeof plugin.start, "function");
  assert.equal(typeof plugin.dispose, "function");
});

test("createPlugin 创建 webspeech 插件", () => {
  const plugin = createPlugin("webspeech", { language: "zh-CN", port: 18765 });
  assert.ok(plugin);
  assert.equal(typeof plugin.start, "function");
  assert.equal(typeof plugin.dispose, "function");
});

test("createPlugin 无效插件名抛错", () => {
  assert.throws(() => createPlugin("invalid", {}), /Unknown plugin/);
});