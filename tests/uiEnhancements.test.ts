import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UI } from "../src/ui/types.js";
import { CostTracker } from "../src/executor/costTracker.js";

/** 捕获 process.stdout.write 输出 */
function captureStdout(run: () => void): string {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    run();
  } finally {
    process.stdout.write = original;
  }
  return writes.join("");
}

describe("UI 接口 - 工具/文件/成本显示方法", () => {
  it("UI 接口应要求打印相关方法", async () => {
    const { createConsoleUI } = await import("../src/ui/console.js");
    const ui = createConsoleUI();

    assert.ok(typeof ui.printToolCall === "function");
    assert.ok(typeof ui.printToolResult === "function");
    assert.ok(typeof ui.printFileChange === "function");
    assert.ok(typeof ui.printCommand === "function");
    assert.ok(typeof ui.printCompletion === "function");
  });

  it("printToolCall 应显示工具名（青色）和输入摘要", async () => {
    const { createConsoleUI } = await import("../src/ui/console.js");
    const ui = createConsoleUI();

    const out = captureStdout(() => ui.printToolCall({ name: "Write", input: { file_path: "src/foo.py" } }));
    assert.ok(out.includes("▶ Write"));
    assert.ok(out.includes("file_path"));
    assert.ok(out.includes("\x1b[36m"), `应使用青色渲染，实际: ${JSON.stringify(out)}`);
  });

  it("printToolResult 成功显示绿色对勾，失败显示红色叉", async () => {
    const { createConsoleUI } = await import("../src/ui/console.js");
    const ui = createConsoleUI();

    const okOut = captureStdout(() => ui.printToolResult("Write", "3 files changed"));
    assert.ok(okOut.includes("✓ Write"));
    assert.ok(okOut.includes("\x1b[32m"), "成功行应使用绿色");

    const errOut = captureStdout(() => ui.printToolResult("Bash", "Error: command not found"));
    assert.ok(errOut.includes("✗ Bash"));
    assert.ok(errOut.includes("\x1b[31m"), "失败行应使用红色");
  });

  it("printFileChange 使用对应颜色图标", async () => {
    const { createConsoleUI } = await import("../src/ui/console.js");
    const ui = createConsoleUI();

    const createOut = captureStdout(() => ui.printFileChange("a.ts", "create"));
    assert.ok(createOut.includes("+ a.ts"));
    assert.ok(createOut.includes("\x1b[32m"));

    const modifyOut = captureStdout(() => ui.printFileChange("b.ts", "modify"));
    assert.ok(modifyOut.includes("b.ts"));
    assert.ok(modifyOut.includes("\x1b[33m"));

    const deleteOut = captureStdout(() => ui.printFileChange("c.ts", "delete"));
    assert.ok(deleteOut.includes("✖ c.ts"));
    assert.ok(deleteOut.includes("\x1b[31m"));
  });

  it("printCommand 显示 $ 前缀命令并可带输出", async () => {
    const { createConsoleUI } = await import("../src/ui/console.js");
    const ui = createConsoleUI();

    const out = captureStdout(() => ui.printCommand("npm test", "pass"));
    assert.ok(out.includes("$ npm test"));
    assert.ok(out.includes("pass"));
    assert.ok(out.includes("\x1b[2m"), "命令应使用暗色渲染");
  });

  it("printCompletion 显示耗时/成本/轮数", async () => {
    const { createConsoleUI } = await import("../src/ui/console.js");
    const ui = createConsoleUI();

    const out = captureStdout(() =>
      ui.printCompletion({ durationMs: 1200, costUsd: 0.01234, turns: 3 })
    );
    assert.ok(out.includes("耗时 1200ms"));
    assert.ok(out.includes("成本 $0.0123"));
    assert.ok(out.includes("3 轮"));
  });
});

describe("CostTracker", () => {
  it("add 累加成本、耗时并计数轮数", () => {
    const tracker = new CostTracker();
    tracker.add({ total_cost_usd: 0.01, duration_ms: 1000 });
    tracker.add({ total_cost_usd: 0.02, duration_ms: 500 });

    const stats = tracker.getStats();
    assert.equal(stats.durationMs, 1500);
    assert.equal(stats.costUsd, 0.03);
    assert.equal(stats.turns, 2);
  });

  it("缺失字段应被忽略", () => {
    const tracker = new CostTracker();
    tracker.add({});
    assert.deepEqual(tracker.getStats(), { durationMs: 0, costUsd: 0, turns: 0 });
  });

  it("reset 应清空累计值", () => {
    const tracker = new CostTracker();
    tracker.add({ total_cost_usd: 0.5, duration_ms: 200 });
    tracker.reset();
    assert.deepEqual(tracker.getStats(), { durationMs: 0, costUsd: 0, turns: 0 });
  });
});

describe("UI mock 完整性", () => {
  it("mock 实现应包含新增方法以满足 UI 接口", () => {
    // 类型层面的接口实现校验（编译期），运行期确保接口渐增不破坏旧实现
    const mockUI: UI = {
      printStatus: (_text: string) => {},
      printRecognition: (_text: string) => {},
      printAssistantDelta: (_text: string) => {},
      printToolLine: (_text: string) => {},
      printToolCall: (_tool: { name: string; input?: unknown }) => {},
      printToolResult: (_tool: string, _result: string) => {},
      printFileChange: (_file: string, _action: "create" | "modify" | "delete") => {},
      printCommand: (_cmd: string, _output?: string) => {},
      printCompletion: (_stats: { durationMs: number; costUsd?: number; turns: number }) => {},
      printError: (_text: string) => {},
      printWarning: (_text: string) => {},
      clearStatusLine: () => {},
      printDownloadProgress: (_progress: number, _message: string) => {},
      promptEditRecognition: async (_text: string) => null,
    };

    assert.ok(typeof mockUI.printToolCall === "function");
    assert.ok(typeof mockUI.printToolResult === "function");
    assert.ok(typeof mockUI.printFileChange === "function");
    assert.ok(typeof mockUI.printCommand === "function");
    assert.ok(typeof mockUI.printCompletion === "function");
  });
});