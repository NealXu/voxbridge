import { test } from "node:test";
import assert from "node:assert/strict";

test("buildChildEnv filters out CLAUDE_* env vars not in whitelist", async () => {
  const { buildChildEnv } = await import("../src/executor/envFilter.js");

  // Save original env and set up test vars
  const originalVars = {
    CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
    CLAUDE_SESSION_ID: process.env.CLAUDE_SESSION_ID,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
  };

  try {
    // Set test environment variables
    process.env.CLAUDE_API_KEY = "secret-key-123";
    process.env.CLAUDE_SESSION_ID = "session-abc";
    process.env.PATH = "/usr/bin:/bin";
    process.env.HOME = "/home/testuser";

    const result = buildChildEnv();

    // Non-CLAUDE vars should be present
    assert.equal(result.PATH, "/usr/bin:/bin", "PATH should be kept");
    assert.equal(result.HOME, "/home/testuser", "HOME should be kept");

    // Non-whitelisted CLAUDE vars should be filtered out
    assert.equal(
      result.CLAUDE_API_KEY,
      undefined,
      "CLAUDE_API_KEY should be filtered"
    );
    assert.equal(
      result.CLAUDE_SESSION_ID,
      undefined,
      "CLAUDE_SESSION_ID should be filtered"
    );
  } finally {
    // Restore original env
    for (const [key, value] of Object.entries(originalVars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("buildChildEnv keeps whitelisted CLAUDE_* env vars", async () => {
  const { buildChildEnv } = await import("../src/executor/envFilter.js");

  // Save original env
  const originalVars = {
    CLAUDE_EXPERIMENTAL_AGENT_TEAMS:
      process.env.CLAUDE_EXPERIMENTAL_AGENT_TEAMS,
    CLAUDE_DISABLE_AUTO_MEMORY: process.env.CLAUDE_DISABLE_AUTO_MEMORY,
  };

  try {
    // Set whitelisted vars
    process.env.CLAUDE_EXPERIMENTAL_AGENT_TEAMS = "true";
    process.env.CLAUDE_DISABLE_AUTO_MEMORY = "1";

    const result = buildChildEnv();

    // Whitelisted CLAUDE vars should be kept
    assert.equal(
      result.CLAUDE_EXPERIMENTAL_AGENT_TEAMS,
      "true",
      "CLAUDE_EXPERIMENTAL_AGENT_TEAMS should be kept"
    );
    assert.equal(
      result.CLAUDE_DISABLE_AUTO_MEMORY,
      "1",
      "CLAUDE_DISABLE_AUTO_MEMORY should be kept"
    );
  } finally {
    // Restore original env
    for (const [key, value] of Object.entries(originalVars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("buildChildEnv applies overrides on top of filtered env", async () => {
  const { buildChildEnv } = await import("../src/executor/envFilter.js");

  // Save original env
  const originalVars = {
    CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
    CUSTOM_VAR: process.env.CUSTOM_VAR,
  };

  try {
    process.env.CLAUDE_API_KEY = "original-key";
    process.env.CUSTOM_VAR = "original-value";

    const result = buildChildEnv({
      CLAUDE_API_KEY: "override-key",
      NEW_VAR: "new-value",
    });

    // Override should be applied (even for filtered CLAUDE vars)
    assert.equal(
      result.CLAUDE_API_KEY,
      "override-key",
      "Override should be applied for CLAUDE_API_KEY"
    );
    // New vars from overrides should be present
    assert.equal(result.NEW_VAR, "new-value", "NEW_VAR from overrides");
    // Original non-CLAUDE vars should be present
    assert.equal(result.CUSTOM_VAR, "original-value", "CUSTOM_VAR preserved");
  } finally {
    // Restore original env
    for (const [key, value] of Object.entries(originalVars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("buildChildEnv handles empty overrides", async () => {
  const { buildChildEnv } = await import("../src/executor/envFilter.js");

  // Should work with no overrides
  const result1 = buildChildEnv();
  assert.ok(typeof result1 === "object", "Should return object");

  // Should work with empty overrides
  const result2 = buildChildEnv({});
  assert.ok(typeof result2 === "object", "Should return object with empty overrides");
});

test("buildChildEnv filters CLAUDE vars while preserving others", async () => {
  const { buildChildEnv } = await import("../src/executor/envFilter.js");

  // Save original env
  const originalVars = {
    CLAUDE_SECRET: process.env.CLAUDE_SECRET,
    CLAUDE_TOKEN: process.env.CLAUDE_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
  };

  try {
    process.env.CLAUDE_SECRET = "secret-data";
    process.env.CLAUDE_TOKEN = "token-xyz";
    process.env.NODE_ENV = "test";

    const result = buildChildEnv();

    // Non-whitelisted CLAUDE vars filtered
    assert.equal(result.CLAUDE_SECRET, undefined, "CLAUDE_SECRET filtered");
    assert.equal(result.CLAUDE_TOKEN, undefined, "CLAUDE_TOKEN filtered");

    // Non-CLAUDE vars kept
    assert.equal(result.NODE_ENV, "test", "NODE_ENV kept");
  } finally {
    // Restore original env
    for (const [key, value] of Object.entries(originalVars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("buildChildEnv override can add whitelisted CLAUDE vars", async () => {
  const { buildChildEnv } = await import("../src/executor/envFilter.js");

  // Ensure whitelisted vars are not set in process.env
  const originalVars = {
    CLAUDE_EXPERIMENTAL_AGENT_TEAMS:
      process.env.CLAUDE_EXPERIMENTAL_AGENT_TEAMS,
    CLAUDE_DISABLE_AUTO_MEMORY: process.env.CLAUDE_DISABLE_AUTO_MEMORY,
  };

  try {
    delete process.env.CLAUDE_EXPERIMENTAL_AGENT_TEAMS;
    delete process.env.CLAUDE_DISABLE_AUTO_MEMORY;

    const result = buildChildEnv({
      CLAUDE_EXPERIMENTAL_AGENT_TEAMS: "true",
      CLAUDE_DISABLE_AUTO_MEMORY: "false",
    });

    // Overrides should add the whitelisted vars
    assert.equal(
      result.CLAUDE_EXPERIMENTAL_AGENT_TEAMS,
      "true",
      "Override adds whitelisted var"
    );
    assert.equal(
      result.CLAUDE_DISABLE_AUTO_MEMORY,
      "false",
      "Override adds whitelisted var"
    );
  } finally {
    // Restore original env
    for (const [key, value] of Object.entries(originalVars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("buildChildEnv override can override whitelisted CLAUDE vars", async () => {
  const { buildChildEnv } = await import("../src/executor/envFilter.js");

  const originalVars = {
    CLAUDE_EXPERIMENTAL_AGENT_TEAMS:
      process.env.CLAUDE_EXPERIMENTAL_AGENT_TEAMS,
  };

  try {
    process.env.CLAUDE_EXPERIMENTAL_AGENT_TEAMS = "false";

    const result = buildChildEnv({
      CLAUDE_EXPERIMENTAL_AGENT_TEAMS: "true",
    });

    // Override should take precedence
    assert.equal(
      result.CLAUDE_EXPERIMENTAL_AGENT_TEAMS,
      "true",
      "Override takes precedence over process.env"
    );
  } finally {
    for (const [key, value] of Object.entries(originalVars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});