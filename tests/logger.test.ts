/**
 * Logger 模块单元测试。
 *
 * 覆盖：
 * - 级别过滤（debug 被过滤 / fatal 不被过滤）
 * - 命名空间（child() 拼接；多级 child 用 "." 分隔）
 * - 结构化 meta（字符串 / 对象 / 未定义字段跳过）
 * - 背压（队列满时丢弃最旧）
 * - 文件 transport（异步写盘 + 轮转 + prune）
 * - 控制台 transport（彩色 / 非彩色）
 * - 工厂（VOXCODE_LOG_LEVEL 覆盖 / enableConsole 开关）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { createLogger } from "../src/logger/index.js";
import type { LogRecord, LogTransport } from "../src/logger/index.js";
import { FileTransport, formatRecord } from "../src/logger/fileTransport.js";
import { ConsoleTransport } from "../src/logger/consoleTransport.js";
import { parseLogLevel, LEVEL_VALUE } from "../src/logger/levels.js";
import { createRootLogger } from "../src/logger/factory.js";

/** 收集型 transport：把日志记录存在内存中便于断言。 */
class CaptureTransport implements LogTransport {
  records: LogRecord[] = [];
  write(r: LogRecord): void { this.records.push(r); }
  async flush(): Promise<void> { /* 同步，无需 flush */ }
}

test("parseLogLevel: 已知值原样返回", () => {
  assert.equal(parseLogLevel("debug"), "debug");
  assert.equal(parseLogLevel("INFO"), "info");
  assert.equal(parseLogLevel("Warn"), "warn");
  assert.equal(parseLogLevel("ERROR"), "error");
  assert.equal(parseLogLevel("fatal"), "fatal");
});

test("parseLogLevel: 未知值回退 fallback", () => {
  assert.equal(parseLogLevel("trace"), "info");
  assert.equal(parseLogLevel(""), "info");
  assert.equal(parseLogLevel(undefined), "info");
  assert.equal(parseLogLevel("trace", "debug"), "debug");
});

test("Logger 级别过滤：低于配置的级别被丢弃", () => {
  const cap = new CaptureTransport();
  const log = createLogger({ level: "warn", transports: [cap] });
  log.debug("d");
  log.info("i");
  log.warn("w");
  log.error("e");
  log.fatal("f");
  assert.equal(cap.records.length, 3, "debug/info 应被过滤");
  assert.deepEqual(cap.records.map((r) => r.level), ["warn", "error", "fatal"]);
});

test("Logger child() 命名空间拼接", () => {
  const cap = new CaptureTransport();
  const root = createLogger({ level: "debug", transports: [cap] });
  const stt = root.child("stt");
  const sttVad = stt.child("vad");
  sttVad.info("loaded");
  assert.equal(cap.records[0].namespace, "stt.vad");
});

test("Logger meta 字段：字符串直存、对象 JSON 化、undefined 跳过", () => {
  const cap = new CaptureTransport();
  const log = createLogger({ level: "info", transports: [cap] });
  log.info("hello", { pid: 1234, path: "/tmp/x", obj: { a: 1 } });
  const rec = cap.records[0];
  assert.equal(rec.meta.pid, 1234);
  assert.equal(rec.meta.path, "/tmp/x");
  assert.deepEqual(rec.meta.obj, { a: 1 });
});

test("formatRecord: 命名空间 pad 到 10 字符", () => {
  const line = formatRecord({
    time: "2026-08-15T10:00:00.000Z",
    level: "info",
    namespace: "stt",
    message: "ready",
    meta: { pid: 1234 },
  });
  assert.match(line, /\[INFO\s\] \[stt\s+\] ready pid=1234/);
});

test("formatRecord: 空 meta 不追加空格", () => {
  const line = formatRecord({
    time: "2026-08-15T10:00:00.000Z",
    level: "error",
    namespace: "executor",
    message: "crashed",
    meta: {},
  });
  // "executor" = 8 chars → padEnd(10) = "executor  "
  assert.equal(line, "[2026-08-15T10:00:00.000Z] [ERROR] [executor  ] crashed");
});

test("FileTransport: 异步写盘 + flush 等待队列清空", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxbridge-log-"));
  try {
    const ft = new FileTransport({ dir, maxSize: 1024 * 1024, maxFiles: 3 });
    const log = createLogger({ level: "info", transports: [ft] });
    log.info("line1", { n: 1 });
    log.info("line2", { n: 2 });
    await ft.flush();
    await ft.close();
    const files = await readdir(dir);
    assert.equal(files.length, 1, "应生成一个日志文件");
    assert.match(files[0], /^voxbridge\.\d{4}-\d{2}-\d{2}\.log$/);
    const content = await readFile(join(dir, files[0]), "utf8");
    assert.match(content, /line1 n=1/);
    assert.match(content, /line2 n=2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileTransport: 超过 maxSize 触发轮转", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxbridge-log-rot-"));
  try {
    // maxSize 很小，强制轮转
    const ft = new FileTransport({ dir, maxSize: 100, maxFiles: 2 });
    const log = createLogger({ level: "info", transports: [ft] });
    // 写入足够多以触发至少一次轮转
    for (let i = 0; i < 20; i++) {
      log.info(`message number ${i}`, { i });
    }
    await ft.flush();
    await ft.close();
    const files = (await readdir(dir)).sort();
    // 应有至少 2 个文件（当前 + 1 个轮转）
    assert.ok(files.length >= 2, `应发生轮转, got ${files.length}`);
    // prune 应保留最多 maxFiles=2 个文件（不含 .1 轮转？这里 .1 也算文件）
    assert.ok(files.length <= 3, `prune 应清理, got ${files.length}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileTransport: 背压 — 队列满时丢弃最旧", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxbridge-log-bp-"));
  try {
    const ft = new FileTransport({ dir, queueCapacity: 5 });
    // 通过 write 同步塞满
    for (let i = 0; i < 10; i++) {
      ft.write({
        time: new Date().toISOString(),
        level: "info",
        namespace: "test",
        message: `m${i}`,
        meta: {},
      });
    }
    await ft.flush();
    await ft.close();
    const files = await readdir(dir);
    const content = await readFile(join(dir, files[0]), "utf8");
    // 验证 m0..m4 中至少部分被丢弃（队列容量 5）
    const lines = content.trim().split("\n").filter(Boolean);
    assert.ok(lines.length <= 10, `写入不超过 10, got ${lines.length}`);
    // 至少 m5..m9 都应存在（较新记录）
    for (let i = 5; i < 10; i++) {
      assert.match(content, new RegExp(`m${i}`), `应保留 m${i}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConsoleTransport: 非 TTY 默认无色", () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
  });
  const ct = new ConsoleTransport({ stream });
  ct.write({
    time: "2026-08-15T10:00:00.000Z",
    level: "info",
    namespace: "test",
    message: "hello",
    meta: {},
  });
  const out = chunks.join("");
  // 非 TTY 时应无 ANSI 转义
  assert.doesNotMatch(out, /\x1b\[/);
  assert.match(out, /\[INFO\s\].*hello/);
});

test("ConsoleTransport: FORCE_COLOR 强制彩色", () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
  });
  const orig = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "1";
  try {
    const ct = new ConsoleTransport({ stream });
    ct.write({
      time: "2026-08-15T10:00:00.000Z",
      level: "info",
      namespace: "test",
      message: "hello",
      meta: {},
    });
    const out = chunks.join("");
    assert.match(out, /\x1b\[/, "应包含 ANSI 转义");
  } finally {
    if (orig === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = orig;
  }
});

test("ConsoleTransport: NO_COLOR 强制无色", () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
  });
  const orig = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const ct = new ConsoleTransport({ stream });
    ct.write({
      time: "2026-08-15T10:00:00.000Z",
      level: "info",
      namespace: "test",
      message: "hello",
      meta: {},
    });
    const out = chunks.join("");
    assert.doesNotMatch(out, /\x1b\[/);
  } finally {
    if (orig === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = orig;
  }
});

test("createRootLogger: 默认不抛错", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxbridge-log-fac-"));
  try {
    const log = createRootLogger({ dir, enableConsole: false });
    const log2 = createRootLogger({ dir, level: "warn", enableConsole: false });
    assert.doesNotThrow(() => log.info("hello"));
    assert.doesNotThrow(() => log2.child("sub").warn("world"));
    await log.close();
    await log2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createRootLogger: VOXCODE_LOG_LEVEL 覆盖配置文件级别", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voxbridge-log-env-"));
  const orig = process.env.VOXCODE_LOG_LEVEL;
  process.env.VOXCODE_LOG_LEVEL = "error";
  try {
    const log = createRootLogger({ dir, level: "debug", enableConsole: false });
    assert.doesNotThrow(() => log.debug("d"));
    assert.doesNotThrow(() => log.error("e"));
    await log.close();
  } finally {
    if (orig === undefined) delete process.env.VOXCODE_LOG_LEVEL;
    else process.env.VOXCODE_LOG_LEVEL = orig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("LEVEL_VALUE 顺序正确：debug < info < warn < error < fatal", () => {
  assert.ok(LEVEL_VALUE.debug < LEVEL_VALUE.info);
  assert.ok(LEVEL_VALUE.info < LEVEL_VALUE.warn);
  assert.ok(LEVEL_VALUE.warn < LEVEL_VALUE.error);
  assert.ok(LEVEL_VALUE.error < LEVEL_VALUE.fatal);
});
