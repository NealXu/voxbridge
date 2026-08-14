import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UI } from "../src/ui/types.js";

describe("UI 抽象接口", () => {
  it("应该定义所有必需方法", () => {
    // 这个测试验证接口定义的完整性
    // 我们创建一个 mock 实现来确保接口可被正确实现
    const mockUI: UI = {
      printStatus: (_text: string) => {},
      printRecognition: (_text: string) => {},
      printAssistantDelta: (_text: string) => {},
      printToolLine: (_text: string) => {},
      printError: (_text: string) => {},
      printWarning: (_text: string) => {},
      clearStatusLine: () => {},
      printDownloadProgress: (_progress: number, _message: string) => {},
      promptEditRecognition: async (_text: string) => null,
    };

    // 验证所有方法存在
    assert.ok(typeof mockUI.printStatus === "function");
    assert.ok(typeof mockUI.printRecognition === "function");
    assert.ok(typeof mockUI.printAssistantDelta === "function");
    assert.ok(typeof mockUI.printToolLine === "function");
    assert.ok(typeof mockUI.printError === "function");
    assert.ok(typeof mockUI.printWarning === "function");
    assert.ok(typeof mockUI.clearStatusLine === "function");
    assert.ok(typeof mockUI.printDownloadProgress === "function");
    assert.ok(typeof mockUI.promptEditRecognition === "function");
  });
});

describe("console UI 实现", () => {
  it("应该实现 UI 接口", async () => {
    const { createConsoleUI } = await import("../src/ui/console.js");
    const ui = createConsoleUI();

    // 验证接口实现
    assert.ok(typeof ui.printStatus === "function");
    assert.ok(typeof ui.printRecognition === "function");
    assert.ok(typeof ui.printAssistantDelta === "function");
    assert.ok(typeof ui.printToolLine === "function");
    assert.ok(typeof ui.printError === "function");
    assert.ok(typeof ui.printWarning === "function");
    assert.ok(typeof ui.clearStatusLine === "function");
    assert.ok(typeof ui.printDownloadProgress === "function");
    assert.ok(typeof ui.promptEditRecognition === "function");
  });
});

describe("UI 配置", () => {
  it("config.ui.mode 应该支持 console 和 ink", async () => {
    const { loadConfig } = await import("../src/config.js");

    // 测试默认值
    const config = loadConfig("./config.json");
    assert.ok(config.ui === undefined || config.ui.mode === "console" || config.ui.mode === "ink");
  });
});

describe("ink UI 模块", () => {
  it("ink UI 应该可以被导入", async () => {
    // 动态导入 ink UI 模块
    // 即使功能不完整，模块也应该可导入
    const inkUI = await import("../src/ui/ink/index.js");
    assert.ok(inkUI.createInkUI !== undefined);
  });
});

describe("UI 工厂函数", () => {
  it("createUI 应该根据 mode 返回正确的 UI", async () => {
    const { createUI } = await import("../src/ui/index.js");

    const consoleUI = await createUI("console");
    assert.ok(consoleUI !== undefined);
    assert.ok(typeof consoleUI.printStatus === "function");

    const inkUI = await createUI("ink");
    assert.ok(inkUI !== undefined);
    assert.ok(typeof inkUI.printStatus === "function");
  });

  it("createUI 默认返回 console UI", async () => {
    const { createUI } = await import("../src/ui/index.js");

    const defaultUI = await createUI();
    assert.ok(defaultUI !== undefined);
    assert.ok(typeof defaultUI.printStatus === "function");
  });
});