/**
 * Tests for DirectorySessionManager.
 *
 * @module session/directorySessionManager.test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectorySessionManager } from "../src/session/directorySessionManager.js";
import type { Config } from "../src/config.js";

function createTestConfig(): Config {
  return {
    stt: { model: "test", model_dir: "/tmp", language: "zh", python_path: "python" },
    trigger: { key: "F9", global: false },
    agent: { resume: false, systemPrompt: "", confirmDangerous: false },
    executor: { persistent: true, idleTimeoutMs: 60000, maxConcurrent: 5 },
  } as Config;
}

test("constructor uses process.cwd() as default activeCwd", () => {
  const manager = new DirectorySessionManager(createTestConfig());
  assert.equal(manager.getActiveCwd(), process.cwd());
});

test("generateChatId normalizes paths to lowercase forward slashes", () => {
  const manager = new DirectorySessionManager(createTestConfig());
  const chatId = manager.generateChatId("D:\\Projects\\MyApp");
  assert.match(chatId, /^[a-z]:\//);
});