import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSession, DEFAULT_SESSION_TTL_MS, saveSessionId } from "../src/session/persistSession.js";

function makeTempFile(): string {
  const dir = join(tmpdir(), `voxbridge-test-${Math.random().toString(36).slice(2)}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "session.json");
}

test("loadSession: 文件不存在 → absent", () => {
  const r = loadSession("/nonexistent/path/session.json");
  assert.equal(r.kind, "absent");
});

test("loadSession: 合法 sessionId + 近期 updatedAt → valid", () => {
  const file = makeTempFile();
  const now = new Date().toISOString();
  writeFileSync(file, JSON.stringify({ sessionId: "sess-1", updatedAt: now }));
  const r = loadSession(file);
  assert.equal(r.kind, "valid");
  if (r.kind === "valid") {
    assert.equal(r.sessionId, "sess-1");
    assert.equal(r.updatedAt, now);
  }
});

test("loadSession: updatedAt 超过 7 天 → expired", () => {
  const file = makeTempFile();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  writeFileSync(file, JSON.stringify({ sessionId: "sess-old", updatedAt: eightDaysAgo }));
  const r = loadSession(file);
  assert.equal(r.kind, "expired");
  if (r.kind === "expired") {
    assert.equal(r.updatedAt, eightDaysAgo);
    assert.ok(r.ageMs > 7 * 24 * 3600 * 1000);
  }
});

test("loadSession: 自定义 maxAgeMs 可以缩短过期窗口", () => {
  const file = makeTempFile();
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  writeFileSync(file, JSON.stringify({ sessionId: "sess-2h", updatedAt: twoHoursAgo }));
  // 1 小时 maxAge → 过期
  const r1 = loadSession(file, 60 * 60 * 1000);
  assert.equal(r1.kind, "expired");
  // 3 小时 maxAge → 有效
  const r2 = loadSession(file, 3 * 60 * 60 * 1000);
  assert.equal(r2.kind, "valid");
});

test("loadSession: 缺少 updatedAt → expired（保守）", () => {
  const file = makeTempFile();
  writeFileSync(file, JSON.stringify({ sessionId: "sess-no-ts" }));
  const r = loadSession(file);
  assert.equal(r.kind, "expired");
});

test("loadSession: sessionId 为空 → absent", () => {
  const file = makeTempFile();
  writeFileSync(file, JSON.stringify({ sessionId: "", updatedAt: new Date().toISOString() }));
  const r = loadSession(file);
  assert.equal(r.kind, "absent");
});

test("loadSession: 非法 JSON → absent", () => {
  const file = makeTempFile();
  writeFileSync(file, "{not json");
  const r = loadSession(file);
  assert.equal(r.kind, "absent");
});

test("DEFAULT_SESSION_TTL_MS = 7 天", () => {
  assert.equal(DEFAULT_SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test("saveSessionId 写下的 sessionId 可被 loadSession 读回", () => {
  const file = makeTempFile();
  saveSessionId(file, "sess-roundtrip");
  const r = loadSession(file);
  assert.equal(r.kind, "valid");
  if (r.kind === "valid") {
    assert.equal(r.sessionId, "sess-roundtrip");
  }
});
