import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWorkerType } from "../../src/stt/workerFactory.js";
import type { Config } from "../../src/config.js";

test("integration: workerType='python' 路由正确", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "python",
  };

  const type = resolveWorkerType(stt);
  assert.equal(type, "python");
});

test("integration: workerType='exe' 路由正确", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "exe",
    workerPath: "test.exe",
  };

  const type = resolveWorkerType(stt);
  assert.equal(type, "exe");
});

test("integration: workerType='native' 路由正确", () => {
  const stt: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "native",
    plugin: "webspeech",
  };

  const type = resolveWorkerType(stt);
  assert.equal(type, "native");
});

test("integration: workerType='auto' 自动选择逻辑", () => {
  // Case 1: plugin=webspeech → native
  const stt1: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "auto",
    plugin: "webspeech",
  };
  assert.equal(resolveWorkerType(stt1), "native");

  // Case 2: workerPath=.exe → exe
  const stt2: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "auto",
    workerPath: "test.exe",
  };
  assert.equal(resolveWorkerType(stt2), "exe");

  // Case 3: cloud config → cloud
  const stt3: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "auto",
    cloud: { provider: "alibaba", apiKey: "key" },
  };
  assert.equal(resolveWorkerType(stt3), "cloud");

  // Case 4: 默认 → python
  const stt4: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerType: "auto",
  };
  assert.equal(resolveWorkerType(stt4), "python");
});

test("integration: 配置字段兼容性", () => {
  // worker_path (旧字段) 应该映射到 workerPath
  const stt1: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    worker_path: "test.exe",
  };
  assert.equal(resolveWorkerType(stt1), "exe");

  // workerPath (新字段) 应该优先
  const stt2: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    workerPath: "test.exe",
  };
  assert.equal(resolveWorkerType(stt2), "exe");

  // pythonPath 别名测试
  const stt3: Config["stt"] = {
    model: "large-v3",
    model_dir: "/models",
    language: "zh",
    python_path: "python",
    pythonPath: "python3",
  };
  assert.equal(resolveWorkerType(stt3), "python");
});

test("integration: 引擎字段不影响 worker 类型", () => {
  const engines = ["whisper", "sensevoice", "paraformer"] as const;

  for (const engine of engines) {
    const stt: Config["stt"] = {
      model: "large-v3",
      model_dir: "/models",
      language: "zh",
      python_path: "python",
      engine,
    };
    assert.equal(resolveWorkerType(stt), "python", `engine=${engine} should not affect worker type`);
  }
});