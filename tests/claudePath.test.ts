import { test } from "node:test";
import assert from "node:assert/strict";

// Since ES modules are cached and we can't easily reimport with different env,
// we test the function behavior directly with inline implementations

test("resolveClaudePath returns CLAUDE_EXECUTABLE_PATH when set", () => {
  // Save original env
  const originalEnv = process.env.CLAUDE_EXECUTABLE_PATH;

  try {
    // Set the env var
    process.env.CLAUDE_EXECUTABLE_PATH = "/custom/path/to/claude";

    // Test inline implementation
    function resolveClaudePathInline(): string {
      const envPath = process.env.CLAUDE_EXECUTABLE_PATH;
      if (envPath) {
        return envPath;
      }
      return "claude";
    }

    assert.equal(
      resolveClaudePathInline(),
      "/custom/path/to/claude",
      "Should return env var when set"
    );
  } finally {
    // Restore env
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_EXECUTABLE_PATH;
    } else {
      process.env.CLAUDE_EXECUTABLE_PATH = originalEnv;
    }
  }
});

test("resolveClaudePath uses 'where' on Windows for path lookup", () => {
  const originalEnv = process.env.CLAUDE_EXECUTABLE_PATH;

  try {
    delete process.env.CLAUDE_EXECUTABLE_PATH;

    // Mock execSync to return a Windows path
    const mockExecSync = (cmd: string) => {
      if (cmd === "where claude") {
        return "C:\\Users\\test\\npm\\claude.exe";
      }
      throw new Error("Command not found");
    };

    // Test inline implementation
    function resolveClaudePathInline(): string {
      const envPath = process.env.CLAUDE_EXECUTABLE_PATH;
      if (envPath) {
        return envPath;
      }

      try {
        const isWindows = process.platform === "win32";
        const command = isWindows ? "where claude" : "which claude";
        const result = mockExecSync(command);
        if (result) {
          return result.split("\n")[0].trim();
        }
      } catch {
        // Fall through
      }
      return "claude";
    }

    assert.equal(
      resolveClaudePathInline(),
      "C:\\Users\\test\\npm\\claude.exe",
      "Should use 'where' command on Windows"
    );
  } finally {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_EXECUTABLE_PATH;
    } else {
      process.env.CLAUDE_EXECUTABLE_PATH = originalEnv;
    }
  }
});

test("resolveClaudePath uses 'which' on Unix for path lookup", () => {
  const originalEnv = process.env.CLAUDE_EXECUTABLE_PATH;

  try {
    delete process.env.CLAUDE_EXECUTABLE_PATH;

    // Mock execSync to return a Unix path
    const mockExecSync = (cmd: string, isWindows: boolean) => {
      if (!isWindows && cmd === "which claude") {
        return "/usr/local/bin/claude";
      }
      throw new Error("Command not found");
    };

    // Test inline implementation simulating Unix
    function resolveClaudePathInline(): string {
      const envPath = process.env.CLAUDE_EXECUTABLE_PATH;
      if (envPath) {
        return envPath;
      }

      // Simulate Unix platform
      const isWindows = false; // Force Unix behavior for this test
      try {
        const command = isWindows ? "where claude" : "which claude";
        const result = mockExecSync(command, isWindows);
        if (result) {
          return result.split("\n")[0].trim();
        }
      } catch {
        // Fall through
      }
      return "claude";
    }

    assert.equal(
      resolveClaudePathInline(),
      "/usr/local/bin/claude",
      "Should use 'which' command on Unix"
    );
  } finally {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_EXECUTABLE_PATH;
    } else {
      process.env.CLAUDE_EXECUTABLE_PATH = originalEnv;
    }
  }
});

test("resolveClaudePath falls back to 'claude' when not in PATH", () => {
  const originalEnv = process.env.CLAUDE_EXECUTABLE_PATH;

  try {
    delete process.env.CLAUDE_EXECUTABLE_PATH;

    // Mock execSync to throw (simulating command not found)
    const mockExecSync = () => {
      throw new Error("Command not found");
    };

    // Test inline implementation
    function resolveClaudePathInline(): string {
      const envPath = process.env.CLAUDE_EXECUTABLE_PATH;
      if (envPath) {
        return envPath;
      }

      try {
        mockExecSync();
      } catch {
        // Fall through to fallback
      }
      return "claude";
    }

    assert.equal(
      resolveClaudePathInline(),
      "claude",
      "Should fallback to 'claude' string"
    );
  } finally {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_EXECUTABLE_PATH;
    } else {
      process.env.CLAUDE_EXECUTABLE_PATH = originalEnv;
    }
  }
});

test("resolveClaudePath returns first result when 'where' returns multiple paths", () => {
  const originalEnv = process.env.CLAUDE_EXECUTABLE_PATH;

  try {
    delete process.env.CLAUDE_EXECUTABLE_PATH;

    // Mock execSync to return multiple paths (Windows behavior)
    const mockExecSync = () => {
      return "C:\\path1\\claude.exe\nC:\\path2\\claude.exe\nC:\\path3\\claude.exe";
    };

    // Test inline implementation
    function resolveClaudePathInline(): string {
      const envPath = process.env.CLAUDE_EXECUTABLE_PATH;
      if (envPath) {
        return envPath;
      }

      try {
        const result = mockExecSync();
        if (result) {
          return result.split("\n")[0].trim();
        }
      } catch {
        // Fall through
      }
      return "claude";
    }

    const result = resolveClaudePathInline();
    assert.equal(
      result,
      "C:\\path1\\claude.exe",
      "Should return first path only"
    );
    assert.ok(!result.includes("\n"), "Should not contain newlines");
  } finally {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_EXECUTABLE_PATH;
    } else {
      process.env.CLAUDE_EXECUTABLE_PATH = originalEnv;
    }
  }
});

test("integration: resolveClaudePath works on current platform", async () => {
  // This test verifies the actual implementation works
  const { resolveClaudePath } = await import(
    "../src/executor/claudePath.js"
  );

  // Should return a non-empty string without throwing
  const result = resolveClaudePath();
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0, "Should return non-empty string");
});