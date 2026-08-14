import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createUI } from "../src/ui/index.js";

describe("createUI 接线", () => {
  it("mode=console 返回 console UI", async () => {
    const ui = await createUI("console");
    assert.equal(typeof ui.printStatus, "function");
    assert.equal(typeof ui.printRecognition, "function");
    assert.equal(typeof ui.printAssistantDelta, "function");
    assert.equal(typeof ui.printToolLine, "function");
    assert.equal(typeof ui.printError, "function");
    assert.equal(typeof ui.printWarning, "function");
    assert.equal(typeof ui.clearStatusLine, "function");
    assert.equal(typeof ui.printDownloadProgress, "function");
    assert.equal(typeof ui.promptEditRecognition, "function");
  });

  it("mode=ink 返回 ink UI（ink 已安装时）", async () => {
    const ui = await createUI("ink");
    assert.equal(typeof ui.printStatus, "function");
    assert.equal(typeof ui.promptEditRecognition, "function");
  });

  it("默认 mode 返回 console UI", async () => {
    const ui = await createUI();
    assert.equal(typeof ui.printStatus, "function");
  });

  it("ink UI printStatus 可调用不抛异常", async () => {
    const ui = await createUI("ink");
    ui.printStatus("测试状态");
    ui.printRecognition("测试识别");
    ui.printToolLine("Write");
    ui.printWarning("警告");
    ui.printError("错误");
    ui.printDownloadProgress(0.5, "下载中");
    ui.clearStatusLine();
  });
});
