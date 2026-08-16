/**
 * E2E tests for persistent session functionality.
 *
 * Tests the DirectorySessionManager integration with the session layer.
 * Requires CLAUDE_INTEGRATION=1 to spawn real claude processes.
 *
 * @module e2e/persistentSession.test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectorySessionManager } from "../../src/session/directorySessionManager.js";
import type { Config } from "../../src/config.js";
import { mkdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createTestConfig(): Config {
  return {
    stt: { model: "test", model_dir: "/tmp", language: "zh", python_path: "python" },
    trigger: { key: "F9", global: false },
    agent: { resume: false, systemPrompt: "", confirmDangerous: false },
    executor: { persistent: true, idleTimeoutMs: 60000, maxConcurrent: 5 },
  } as Config;
}

test("persistent session manager can be created and shutdown", async () => {
  const config = createTestConfig();
  const manager = new DirectorySessionManager(config);

  assert.equal(manager.getActiveCwd(), process.cwd());

  await manager.shutdown();
});

test("persistent session manager switches directories correctly", async () => {
  const config = createTestConfig();
  const manager = new DirectorySessionManager(config);

  // Create temp directories
  const tempDir1 = join(tmpdir(), `voxbridge-test-${Date.now()}-1`);
  const tempDir2 = join(tmpdir(), `voxbridge-test-${Date.now()}-2`);

  mkdirSync(tempDir1, { recursive: true });
  mkdirSync(tempDir2, { recursive: true });

  try {
    // Switch to dir1
    const result1 = await manager.switchDirectory(tempDir1);
    assert.equal(result1.ok, true);
    assert.equal(manager.getActiveCwd(), tempDir1);

    // Switch to dir2
    const result2 = await manager.switchDirectory(tempDir2);
    assert.equal(result2.ok, true);
    assert.equal(manager.getActiveCwd(), tempDir2);

    // Release and shutdown
    await manager.release("test complete");
  } finally {
    await manager.shutdown();
    rmdirSync(tempDir1);
    rmdirSync(tempDir2);
  }
});

test("persistent session manager tracks known projects", async () => {
  const config = createTestConfig();
  const manager = new DirectorySessionManager(config);

  const tempDir = join(tmpdir(), `voxbridge-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    await manager.switchDirectory(tempDir);
    assert.equal(manager.isKnownProject(tempDir), true);
    assert.equal(manager.isKnownProject("/nonexistent"), false);
  } finally {
    await manager.shutdown();
    rmdirSync(tempDir);
  }
});

test("chatId generation is consistent across calls", () => {
  const config = createTestConfig();
  const manager = new DirectorySessionManager(config);

  const id1 = manager.generateChatId("D:\\Projects\\Test");
  const id2 = manager.generateChatId("D:/projects/test");

  assert.equal(id1, id2);
});

test("chatId differs for different directories", () => {
  const config = createTestConfig();
  const manager = new DirectorySessionManager(config);

  const id1 = manager.generateChatId("/home/user/project1");
  const id2 = manager.generateChatId("/home/user/project2");

  assert.notEqual(id1, id2);
});

// Integration tests (require CLAUDE_INTEGRATION=1)
test("integration: persistent session reuses executor for same directory", async () => {
  // This test requires a real claude process
  // Skip if CLAUDE_INTEGRATION is not set
  if (!process.env.CLAUDE_INTEGRATION) {
    return;
  }

  const config = createTestConfig();
  const manager = new DirectorySessionManager(config);

  try {
    // First acquire
    const entry1 = await manager.acquire();
    await manager.release("first turn");

    // Second acquire should reuse
    const entry2 = await manager.acquire();

    // Should be same executor (reused)
    assert.equal(entry1.executor, entry2.executor);

    await manager.release("second turn");
  } finally {
    await manager.shutdown();
  }
});