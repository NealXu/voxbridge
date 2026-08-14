import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSessionId, saveSessionId, clearSessionId } from "../src/session/persistSession.js";
import { createAgentSession } from "../src/session/agentSession.js";

test("loadSessionId: 文件不存在返回 undefined", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-"));
  const sessionFile = join(tempDir, "session.json");

  try {
    // 文件不存在
    const result = loadSessionId(sessionFile);
    assert.equal(result, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadSessionId: 文件存在返回 sessionId", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-"));
  const sessionFile = join(tempDir, "session.json");

  try {
    // 写入测试文件
    const content = JSON.stringify({ sessionId: "test-session-123", updatedAt: new Date().toISOString() });
    await import("node:fs/promises").then(fs => fs.writeFile(sessionFile, content, "utf8"));

    const result = loadSessionId(sessionFile);
    assert.equal(result, "test-session-123");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("saveSessionId: 写入文件，可被 loadSessionId 读回", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-"));
  const sessionFile = join(tempDir, "session.json");

  try {
    saveSessionId(sessionFile, "my-session-id");

    const loaded = loadSessionId(sessionFile);
    assert.equal(loaded, "my-session-id");

    // 验证文件内容包含时间戳
    const content = await readFile(sessionFile, "utf8");
    const parsed = JSON.parse(content);
    assert.ok(parsed.updatedAt);
    assert.ok(new Date(parsed.updatedAt).getTime() > 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("clearSessionId: 删除文件", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-"));
  const sessionFile = join(tempDir, "session.json");

  try {
    // 先写入
    saveSessionId(sessionFile, "to-be-deleted");
    assert.equal(loadSessionId(sessionFile), "to-be-deleted");

    // 清除
    clearSessionId(sessionFile);

    // 应该不存在了
    assert.equal(loadSessionId(sessionFile), undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("saveSessionId: 写入失败时静默忽略（不抛异常）", async () => {
  // 尝试写入到无效路径
  const invalidPath = "/nonexistent/path/that/does/not/exist/session.json";

  // 不应抛出异常
  assert.doesNotThrow(() => {
    saveSessionId(invalidPath, "test-id");
  });
});

test("loadSessionId: 文件内容无效 JSON 时返回 undefined", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-"));
  const sessionFile = join(tempDir, "session.json");

  try {
    // 写入无效 JSON
    await import("node:fs/promises").then(fs => fs.writeFile(sessionFile, "invalid json", "utf8"));

    const result = loadSessionId(sessionFile);
    assert.equal(result, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentSession: 启动时加载已保存的 sessionId", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-"));
  const sessionFile = join(tempDir, "session.json");

  try {
    // 预先写入一个 sessionId
    saveSessionId(sessionFile, "saved-session-xyz");

    // 创建 session，应加载已保存的 sessionId
    const q = await createCapturingQuery([
      { type: "system", subtype: "init", session_id: "saved-session-xyz" },
      { type: "result", subtype: "success", session_id: "saved-session-xyz" },
    ]);

    const config = makeConfig();
    const session = createAgentSession({
      config,
      cwd: process.cwd(),
      callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: () => {} },
      queryImpl: q.impl as any,
      sessionFile,  // 新增参数
    });

    await session.send("first");

    // 第一次调用应该使用保存的 sessionId
    assert.equal(q.calls[0].options.resume, "saved-session-xyz");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentSession: send 成功后保存 sessionId", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-"));
  const sessionFile = join(tempDir, "session.json");

  try {
    const q = await createCapturingQuery([
      { type: "system", subtype: "init", session_id: "new-session-456" },
      { type: "result", subtype: "success", session_id: "new-session-456" },
    ]);

    const session = createAgentSession({
      config: makeConfig(),
      cwd: process.cwd(),
      callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: () => {} },
      queryImpl: q.impl as any,
      sessionFile,
    });

    await session.send("test");

    // 检查文件已保存
    const saved = loadSessionId(sessionFile);
    assert.equal(saved, "new-session-456");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentSession: reset() 后清除 sessionId 文件", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-"));
  const sessionFile = join(tempDir, "session.json");

  try {
    const q = await createCapturingQuery([
      { type: "system", subtype: "init", session_id: "session-789" },
      { type: "result", subtype: "success", session_id: "session-789" },
    ]);

    const session = createAgentSession({
      config: makeConfig(),
      cwd: process.cwd(),
      callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: () => {} },
      queryImpl: q.impl as any,
      sessionFile,
    });

    await session.send("test");
    assert.equal(loadSessionId(sessionFile), "session-789");

    session.reset();

    // 文件应被删除
    assert.equal(loadSessionId(sessionFile), undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// Helper functions
async function createCapturingQuery(messages: any[]) {
  const calls: Array<{ prompt: string; options: any }> = [];
  const impl = async function* (params: any) {
    calls.push({ prompt: params.prompt, options: params.options });
    for (const m of messages) yield m;
  };
  return { impl, calls };
}

function makeConfig() {
  return { stt: {} as any, trigger: {} as any, agent: { resume: true, systemPrompt: "" }, ui: {} as any };
}