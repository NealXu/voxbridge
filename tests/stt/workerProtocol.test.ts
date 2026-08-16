/**
 * Worker 协议编解码测试 (TDD Red Phase)
 * 测试新的插件化 Worker 协议规范
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCommand, parseEvent } from "../../src/stt/workerProtocol.js";
import type {
  WorkerCommand,
  WorkerEvent,
  WorkerConfig,
  WorkerCapabilities,
} from "../../src/stt/workerProtocol.js";

test("encodeCommand - init 命令", () => {
  const config: WorkerConfig = {
    engine: "whisper",
    language: "zh",
    modelDir: "/models/whisper",
    model: "large-v3",
  };
  const cmd: WorkerCommand = { type: "init", config };
  const encoded = encodeCommand(cmd);

  // 验证是单行 JSON
  assert.ok(encoded.endsWith("\n"), "应以换行结尾");
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.type, "init");
  assert.deepEqual(parsed.config, config);
});

test("encodeCommand - start 命令", () => {
  const cmd: WorkerCommand = { type: "start" };
  const encoded = encodeCommand(cmd);

  assert.equal(encoded, '{"type":"start"}\n');
});

test("encodeCommand - stop 命令", () => {
  const cmd: WorkerCommand = { type: "stop" };
  const encoded = encodeCommand(cmd);

  assert.equal(encoded, '{"type":"stop"}\n');
});

test("encodeCommand - cancel 命令", () => {
  const cmd: WorkerCommand = { type: "cancel" };
  const encoded = encodeCommand(cmd);

  assert.equal(encoded, '{"type":"cancel"}\n');
});

test("encodeCommand - quit 命令", () => {
  const cmd: WorkerCommand = { type: "quit" };
  const encoded = encodeCommand(cmd);

  assert.equal(encoded, '{"type":"quit"}\n');
});

test("encodeCommand - init 命令包含 VAD 配置", () => {
  const config: WorkerConfig = {
    engine: "whisper",
    language: "zh",
    vad: {
      threshold: 0.5,
      minVoiceMs: 300,
      silenceRms: 0.01,
      noiseMaxRms: 0.05,
      chunkMs: 50,
      endpointSilenceMs: 800,
    },
  };
  const cmd: WorkerCommand = { type: "init", config };
  const encoded = encodeCommand(cmd);

  const parsed = JSON.parse(encoded);
  assert.deepEqual(parsed.config.vad, config.vad);
});

test("encodeCommand - init 命令包含唤醒词配置", () => {
  const config: WorkerConfig = {
    engine: "whisper",
    language: "zh",
    wakeWord: {
      enabled: true,
      phrase: "你好小助手",
    },
  };
  const cmd: WorkerCommand = { type: "init", config };
  const encoded = encodeCommand(cmd);

  const parsed = JSON.parse(encoded);
  assert.deepEqual(parsed.config.wakeWord, config.wakeWord);
});

test("parseEvent - ready 事件", () => {
  const caps: WorkerCapabilities = {
    streaming: true,
    wakeWord: false,
    languages: ["zh", "en"],
    confidence: true,
    wordTimestamps: true,
  };
  const line = JSON.stringify({ type: "ready", engine: "whisper", capabilities: caps });
  const event = parseEvent(line);

  assert.equal(event.type, "ready");
  if (event.type === "ready") {
    assert.equal(event.engine, "whisper");
    assert.deepEqual(event.capabilities, caps);
  }
});

test("parseEvent - recording 事件", () => {
  const line = '{"type":"recording"}';
  const event = parseEvent(line);

  assert.deepEqual(event, { type: "recording" });
});

test("parseEvent - result 事件", () => {
  const line = '{"type":"result","text":"你好世界","duration_ms":1200}';
  const event = parseEvent(line);

  assert.equal(event.type, "result");
  if (event.type === "result") {
    assert.equal(event.text, "你好世界");
    assert.equal(event.duration_ms, 1200);
  }
});

test("parseEvent - result 事件包含 is_final 字段", () => {
  const line = '{"type":"result","text":"你好","duration_ms":500,"is_final":false}';
  const event = parseEvent(line);

  assert.equal(event.type, "result");
  if (event.type === "result") {
    assert.equal(event.is_final, false);
  }
});

test("parseEvent - partial 事件", () => {
  const line = '{"type":"partial","text":"你好"}';
  const event = parseEvent(line);

  assert.deepEqual(event, { type: "partial", text: "你好" });
});

test("parseEvent - noise 事件", () => {
  const line = '{"type":"noise"}';
  const event = parseEvent(line);

  assert.deepEqual(event, { type: "noise" });
});

test("parseEvent - error 事件", () => {
  const line = '{"type":"error","code":"E001","message":"未检测到音频输入设备","recoverable":false}';
  const event = parseEvent(line);

  assert.equal(event.type, "error");
  if (event.type === "error") {
    assert.equal(event.code, "E001");
    assert.equal(event.message, "未检测到音频输入设备");
    assert.equal(event.recoverable, false);
  }
});

test("parseEvent - error 事件 code 可选", () => {
  const line = '{"type":"error","message":"未检测到音频输入设备","recoverable":true}';
  const event = parseEvent(line);

  assert.equal(event.type, "error");
  if (event.type === "error") {
    assert.equal(event.code, undefined);
    assert.equal(event.recoverable, true);
  }
});

test("parseEvent - downloading 事件", () => {
  const line = '{"type":"downloading","progress":0.75,"message":"下载模型文件 75%"}';
  const event = parseEvent(line);

  assert.equal(event.type, "downloading");
  if (event.type === "downloading") {
    assert.equal(event.progress, 0.75);
    assert.equal(event.message, "下载模型文件 75%");
  }
});

test("parseEvent - wake 事件", () => {
  const line = '{"type":"wake","phrase":"你好小助手","heard":"你好小树"}';
  const event = parseEvent(line);

  assert.equal(event.type, "wake");
  if (event.type === "wake") {
    assert.equal(event.phrase, "你好小助手");
    assert.equal(event.heard, "你好小树");
  }
});

test("parseEvent - wake 事件字段可选", () => {
  const line = '{"type":"wake"}';
  const event = parseEvent(line);

  assert.deepEqual(event, { type: "wake" });
});

test("协议向后兼容 - 支持 start/stop/quit 命令", () => {
  // 确保旧的命令仍然有效
  assert.equal(encodeCommand({ type: "start" }), '{"type":"start"}\n');
  assert.equal(encodeCommand({ type: "stop" }), '{"type":"stop"}\n');
  assert.equal(encodeCommand({ type: "quit" }), '{"type":"quit"}\n');
});

test("协议向后兼容 - 支持旧事件格式", () => {
  // 确保旧的事件格式仍然可以解析
  const event1 = parseEvent('{"type":"ready"}');
  assert.equal(event1.type, "ready");

  const event2 = parseEvent('{"type":"result","text":"测试","duration_ms":500}');
  assert.equal(event2.type, "result");

  const event3 = parseEvent('{"type":"noise"}');
  assert.equal(event3.type, "noise");
});

test("encodeCommand - 中文编码正确", () => {
  const config: WorkerConfig = {
    engine: "whisper",
    language: "zh",
    wakeWord: { enabled: true, phrase: "你好世界" },
  };
  const cmd: WorkerCommand = { type: "init", config };
  const encoded = encodeCommand(cmd);

  // 验证中文不被转义成 Unicode
  assert.ok(encoded.includes("你好世界"), "应保留中文原样");
  assert.ok(!encoded.includes("\\u"), "不应使用 Unicode 转义");
});

test("parseEvent - 中文解析正确", () => {
  const line = '{"type":"result","text":"你好世界","duration_ms":1000}';
  const event = parseEvent(line);

  assert.equal(event.type, "result");
  if (event.type === "result") {
    assert.equal(event.text, "你好世界");
  }
});