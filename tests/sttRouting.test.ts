import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSttClient } from "../src/stt/index.js";
import type { Config } from "../src/config.js";

function makeConfig(port: number): Config["stt"] {
  return {
    model: "large-v3",
    model_dir: "D:\\Models\\faster-whisper-large-v3",
    language: "zh",
    python_path: ".venv\\Scripts\\python.exe",
    plugin: "webspeech",
    webspeech: { language: "zh-CN", port, openBrowser: false },
  };
}

describe("createSttClient 插件路由", () => {
  it("plugin=webspeech 返回可用的 SttClient", () => {
    const client = createSttClient(makeConfig(19330), process.cwd());
    assert.ok(client !== null);
    assert.equal(typeof client.start, "function");
    assert.equal(typeof client.stop, "function");
    assert.equal(typeof client.cancel, "function");
    assert.equal(typeof client.dispose, "function");
    assert.equal(typeof client.waitReady, "function");
    assert.equal(typeof client.quit, "function");
  });

  it("waitReady 启动 HTTP 服务器并服务页面", async () => {
    const port = 19331;
    const client = createSttClient(makeConfig(port), process.cwd());
    await client.waitReady(5000);

    const res = await fetch(`http://localhost:${port}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("SpeechRecognition"));

    await client.dispose();
  });

  it("无 WebSocket 连接时 start 抛错（预期行为）", async () => {
    const port = 19332;
    const client = createSttClient(makeConfig(port), process.cwd());
    await client.waitReady(5000);

    // 未连接浏览器时 start 应抛 "WebSocket client not connected"
    assert.throws(() => client.start());

    await client.dispose();
  });

  it("cancel + quit + dispose 完整生命周期", async () => {
    const port = 19333;
    const client = createSttClient(makeConfig(port), process.cwd());
    await client.waitReady(5000);
    client.cancel(); // cancel 无连接也不抛
    await client.quit(); // quit 空操作
    await client.dispose();
  });
});
