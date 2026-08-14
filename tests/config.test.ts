import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

function withConfig(obj: unknown, fn: (p: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "vcc-"));
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify(obj));
  try { fn(p); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("解析合法配置", () => {
  withConfig({
    stt: { model: "large-v3", model_dir: "D:/Models/x", language: "zh", python_path: "py" },
    trigger: { key: "F9", global: true },
  }, (p) => {
    const c = loadConfig(p);
    assert.equal(c.stt.model, "large-v3");
    assert.equal(c.trigger.key, "F9");
    assert.equal(c.agent.resume, true); // 缺省
  });
});

test("confirmDangerous 默认为 true", () => {
  withConfig({
    stt: { model: "large-v3", model_dir: "D:/Models/x", language: "zh", python_path: "py" },
    trigger: { key: "F9", global: true },
  }, (p) => {
    const c = loadConfig(p);
    assert.equal(c.agent.confirmDangerous, true);
  });
});

test("confirmDangerous 可显式设为 false", () => {
  withConfig({
    stt: { model: "large-v3", model_dir: "D:/Models/x", language: "zh", python_path: "py" },
    trigger: { key: "F9", global: true },
    agent: { confirmDangerous: false },
  }, (p) => {
    const c = loadConfig(p);
    assert.equal(c.agent.confirmDangerous, false);
  });
});

test("非法 JSON 报错", () => {
  const dir = mkdtempSync(join(tmpdir(), "vcc-"));
  const p = join(dir, "config.json");
  writeFileSync(p, "{ not json");
  try { assert.throws(() => loadConfig(p)); } finally { rmSync(dir, { recursive: true, force: true }); }
});
