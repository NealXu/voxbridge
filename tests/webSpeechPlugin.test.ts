import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSpeechPlugin } from "../src/stt/plugins/webSpeechPlugin.js";
import { request } from "node:http";

test("WebSpeechPlugin 启动 HTTP 服务器", async () => {
  const plugin = new WebSpeechPlugin({ language: "zh-CN", port: 18765 });
  await plugin.start();

  // 检查服务器是否启动
  const response = await new Promise<string>((resolve, reject) => {
    const req = request({ hostname: "localhost", port: 18765, path: "/", method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => { resolve(body); });
    });
    req.on("error", reject);
    req.end();
  });

  assert.ok(response.includes("webkitSpeechRecognition"), "HTML 页面应包含 Web Speech API");
  await plugin.dispose();
});

test("WebSpeechPlugin HTML 页面包含必要的 JavaScript", async () => {
  const plugin = new WebSpeechPlugin({ language: "zh-CN", port: 18766 });
  await plugin.start();

  const response = await new Promise<string>((resolve, reject) => {
    const req = request({ hostname: "localhost", port: 18766, path: "/", method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => { resolve(body); });
    });
    req.on("error", reject);
    req.end();
  });

  // 检查页面包含必要的 JS 代码
  assert.ok(response.includes("recognition.lang"), "应设置识别语言");
  assert.ok(response.includes("WebSocket"), "应使用 WebSocket 通信");
  assert.ok(response.includes("recognition.start()"), "应启动识别");

  await plugin.dispose();
});

test("WebSpeechPlugin dispose 关闭服务器", async () => {
  const plugin = new WebSpeechPlugin({ language: "zh-CN", port: 18767 });
  await plugin.start();
  await plugin.dispose();

  // 服务器关闭后请求应失败
  await new Promise<void>((resolve) => {
    const req = request({ hostname: "localhost", port: 18767, path: "/", method: "GET" }, () => {
      // 不应该成功
    });
    req.on("error", () => { resolve(); }); // 连接失败表示服务器已关闭
    req.end();
  });
});