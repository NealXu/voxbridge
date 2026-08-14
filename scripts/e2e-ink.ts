/**
 * ink TUI e2e 烟测
 * 创建 ink UI -> 调用各方法 -> 验证 store 状态变化 -> 退出
 */
import { createUI } from "../src/ui/index.js";
import { getState } from "../src/ui/ink/store.js";

const ui = await createUI("ink");

ui.printStatus("正在初始化...");
await new Promise((r) => setTimeout(r, 100));

ui.printStatus("就绪，按 F9 说话");
await new Promise((r) => setTimeout(r, 100));

ui.printStatus("\u{1F399} 录音中...");
await new Promise((r) => setTimeout(r, 100));

ui.printRecognition("创建一个 hello.py");
await new Promise((r) => setTimeout(r, 100));

ui.clearStatusLine();
ui.printToolLine("Write");
ui.printAssistantDelta("好的，我来创建");
ui.printAssistantDelta(" hello.py");
await new Promise((r) => setTimeout(r, 100));

ui.printWarning("[危险操作] Write");
ui.printError("测试错误");

const status = getState<string>("status");
const recognition = getState<string>("recognition");
const outputLines = getState<string[]>("outputLines");

console.error("\n--- e2e 验证结果 ---");
console.error(`status: ${status}`);
console.error(`recognition: ${recognition}`);
console.error(`outputLines (${outputLines.length}):`);
for (const line of outputLines) {
  console.error(`  ${line}`);
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean) {
  if (ok) { passed++; console.error(`  PASS ${name}`); }
  else { failed++; console.error(`  FAIL ${name}`); }
}

check("status 包含错误", status.includes("错误"));
check("recognition 已清除", recognition === "");
check("outputLines 有内容", outputLines.length > 0);
check("包含工具行", outputLines.some((l) => l.includes("Write")));
check("包含助手文本", outputLines.some((l) => l.includes("hello.py")));
check("包含警告", outputLines.some((l) => l.includes("危险操作")));
check("包含错误", outputLines.some((l) => l.includes("测试错误")));

console.error(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
