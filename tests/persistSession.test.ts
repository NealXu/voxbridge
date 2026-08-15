import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSessionId, saveSessionId, clearSessionId } from "../src/session/persistSession.js";
import { createAgentSession } from "../src/session/agentSession.js";
import { ClaudeExecutor } from "../src/executor/claudeExecutor.js";
import type { SDKMessage } from "../src/executor/types.js";
import type { Query } from "@anthropic-ai/claude-agent-sdk";

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
  // 创建一个只读目录，使其子路径无法写入
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-readonly-"));
  const readOnlyDir = join(tempDir, "readonly");
  const { mkdirSync, chmodSync } = await import("node:fs");
  mkdirSync(readOnlyDir);
  chmodSync(readOnlyDir, 0o444); // 只读

  const invalidPath = join(readOnlyDir, "subdir", "session.json");

  try {
    // 不应抛出异常（即使 mkdirSync 递归失败或写入失败）
    assert.doesNotThrow(() => {
      saveSessionId(invalidPath, "test-id");
    });
  } finally {
    // 恢复权限以便清理
    try { chmodSync(readOnlyDir, 0o755); } catch {}
    await rm(tempDir, { recursive: true, force: true });
  }
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
    const { executor, calls } = createCapturingExecutor([
      { type: "system", subtype: "init", session_id: "saved-session-xyz" },
      { type: "result", subtype: "success", session_id: "saved-session-xyz" },
    ]);

    const config = makeConfig();
    const session = createAgentSession({
      config,
      cwd: process.cwd(),
      callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: () => {} },
      executor,
      sessionFile,  // 新增参数
    });

    await session.send("first");

    // 第一次调用应该使用保存的 sessionId
    assert.equal(calls[0].options.resume, "saved-session-xyz");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agentSession: send 成功后保存 sessionId", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "voxcode-test-"));
  const sessionFile = join(tempDir, "session.json");

  try {
    const { executor, resume } = createCapturingExecutor([
      { type: "system", subtype: "init", session_id: "new-session-456" },
      { type: "result", subtype: "success", session_id: "new-session-456" },
    ]);

    const session = createAgentSession({
      config: makeConfig(),
      cwd: process.cwd(),
      callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: () => {} },
      executor,
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
    const { executor } = createCapturingExecutor([
      { type: "system", subtype: "init", session_id: "session-789" },
      { type: "result", subtype: "success", session_id: "session-789" },
    ]);

    const session = createAgentSession({
      config: makeConfig(),
      cwd: process.cwd(),
      callbacks: { onTextDelta: () => {}, onToolStart: () => {}, onStatus: () => {} },
      executor,
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

// Helper: create a ClaudeExecutor backed by a captured query, recording
// the SDK options (prompt/options) so tests can assert on resume etc.
function createCapturingExecutor(messages: SDKMessage[]) {
  const calls: Array<{ prompt: string; options: any }> = [];
  const resume: string[] = [];
  const mockQuery = (params: {
    prompt: string | AsyncIterable<unknown>;
    options?: { resume?: string };
  }) => {
    calls.push({ prompt: typeof params.prompt === "string" ? params.prompt : "", options: params.options });
    if (params.options?.resume) {
      resume.push(params.options.resume);
    }
    return {
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m;
      },
      close: () => {},
    } as unknown as Query;
  };
  const executor = new ClaudeExecutor(mockQuery as any);
  return { executor, calls, resume };
}

function makeConfig() {
  return { stt: {} as any, trigger: {} as any, agent: { resume: true, systemPrompt: "", confirmDangerous: false }, ui: {} as any };
}