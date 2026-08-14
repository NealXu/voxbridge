import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PluginSttClientAdapter } from "../src/stt/pluginAdapter.js";
import type { SttPlugin } from "../src/stt/pluginTypes.js";

function createMockPlugin(overrides?: Partial<SttPlugin>): SttPlugin {
  return {
    start: async () => {},
    startRecording: () => {},
    stopRecording: async () => ({ kind: "text", text: "测试文本" }),
    dispose: async () => {},
    ...overrides,
  };
}

describe("PluginSttClientAdapter", () => {
  it("waitReady 调用 plugin.start()", async () => {
    let started = false;
    const plugin = createMockPlugin({ start: async () => { started = true; } });
    const adapter = new PluginSttClientAdapter(plugin);

    await adapter.waitReady();
    assert.equal(started, true);
  });

  it("start 调用 plugin.startRecording()", async () => {
    let recording = false;
    const plugin = createMockPlugin({ startRecording: () => { recording = true; } });
    const adapter = new PluginSttClientAdapter(plugin);
    await adapter.waitReady();

    adapter.start();
    assert.equal(recording, true);
  });

  it("stop 调用 plugin.stopRecording() 并返回结果", async () => {
    const plugin = createMockPlugin({
      stopRecording: async () => ({ kind: "text", text: "hello" }),
    });
    const adapter = new PluginSttClientAdapter(plugin);
    await adapter.waitReady();

    const result = await adapter.stop();
    assert.equal(result.kind, "text");
    if (result.kind === "text") assert.equal(result.text, "hello");
  });

  it("cancel 丢弃当前录音", async () => {
    const plugin = createMockPlugin();
    const adapter = new PluginSttClientAdapter(plugin);
    await adapter.waitReady();

    adapter.start();
    adapter.cancel();
  });

  it("dispose 调用 plugin.dispose()", async () => {
    let disposed = false;
    const plugin = createMockPlugin({ dispose: async () => { disposed = true; } });
    const adapter = new PluginSttClientAdapter(plugin);
    await adapter.waitReady();

    await adapter.dispose();
    assert.equal(disposed, true);
  });

  it("quit 为空操作不抛异常", async () => {
    const plugin = createMockPlugin();
    const adapter = new PluginSttClientAdapter(plugin);
    await adapter.quit();
  });

  it("未 ready 时 start 不执行", () => {
    let recording = false;
    const plugin = createMockPlugin({ startRecording: () => { recording = true; } });
    const adapter = new PluginSttClientAdapter(plugin);

    adapter.start();
    assert.equal(recording, false);
  });

  it("未 ready 时 stop 返回 error", async () => {
    const plugin = createMockPlugin();
    const adapter = new PluginSttClientAdapter(plugin);

    const result = await adapter.stop();
    assert.equal(result.kind, "error");
  });
});
