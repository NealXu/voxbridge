import { test } from "node:test";
import assert from "node:assert/strict";
import { isDangerousTool } from "../src/session/dangerousTools.js";

test("危险工具返回 true", () => {
  assert.equal(isDangerousTool("Write"), true);
  assert.equal(isDangerousTool("Edit"), true);
  assert.equal(isDangerousTool("NotebookEdit"), true);
});

test("Bash 命令需要进一步检查，暂返回 true", () => {
  assert.equal(isDangerousTool("Bash"), true);
});

test("安全工具返回 false", () => {
  assert.equal(isDangerousTool("Read"), false);
  assert.equal(isDangerousTool("Glob"), false);
  assert.equal(isDangerousTool("Grep"), false);
  assert.equal(isDangerousTool("Agent"), false);
  assert.equal(isDangerousTool("WebFetch"), false);
  assert.equal(isDangerousTool("WebSearch"), false);
});