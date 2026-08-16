import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWorkerType, type WorkerType } from "../../src/stt/workerFactory.js";
import type { Config } from "../../src/config.js";

test("resolveWorkerType: 显式指定 workerType 返回对应类型", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "exe",
  };
  assert.equal(resolveWorkerType(stt), "exe");
});

test("resolveWorkerType: workerType='python' 返回 python", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "python",
  };
  assert.equal(resolveWorkerType(stt), "python");
});

test("resolveWorkerType: plugin='webspeech' 返回 native", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    plugin: "webspeech",
  };
  assert.equal(resolveWorkerType(stt), "native");
});

test("resolveWorkerType: workerPath 以 .exe 结尾返回 exe", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerPath: "dist/voxbridge-asr.exe",
  };
  assert.equal(resolveWorkerType(stt), "exe");
});

test("resolveWorkerType: 云 API 配置返回 cloud", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    cloud: {
      provider: "alibaba",
      apiKey: "test-api-key",
    },
  };
  assert.equal(resolveWorkerType(stt), "cloud");
});

test("resolveWorkerType: 默认返回 python", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
  };
  assert.equal(resolveWorkerType(stt), "python");
});

test("resolveWorkerType: workerType='auto' 时根据配置自动选择", () => {
  // plugin=webspeech → native
  const stt1: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "auto",
    plugin: "webspeech",
  };
  assert.equal(resolveWorkerType(stt1), "native");

  // workerPath=.exe → exe
  const stt2: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "auto",
    workerPath: "test.exe",
  };
  assert.equal(resolveWorkerType(stt2), "exe");

  // cloud config → cloud
  const stt3: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "auto",
    cloud: { provider: "alibaba", apiKey: "key" },
  };
  assert.equal(resolveWorkerType(stt3), "cloud");

  // 默认 → python
  const stt4: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "auto",
  };
  assert.equal(resolveWorkerType(stt4), "python");
});

test("resolveWorkerType: engine 字段不影响 worker 类型", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    engine: "sensevoice",
  };
  assert.equal(resolveWorkerType(stt), "python");
});