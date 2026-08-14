const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

import type { UI } from "./types.js";
import type { ToolCallInfo, CompletionStats } from "../executor/types.js";

/** 判断工具返回文本是否表示失败 */
function isFailedResult(result: string): boolean {
  return /error|failed|✖/i.test(result) || result.startsWith("Error");
}

/** 将工具输入整理为单行摘要 */
function summarizeInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function printStatus(text: string): void { process.stdout.write(`\r\x1b[K${YELLOW}${text}${RESET}`); }
export function printRecognition(text: string): void { process.stdout.write(`\r${GREEN}🎤 ${text}${RESET}\n`); }
export function printAssistantDelta(text: string): void { process.stdout.write(text); }
export function printToolLine(text: string): void { process.stdout.write(`\n${DIM}└ ${text}${RESET}\n`); }

export function printToolCall(tool: ToolCallInfo): void {
  process.stdout.write(`\n${CYAN}▶ ${tool.name}${RESET}\n`);
  if (tool.input !== undefined && tool.input !== null) {
    process.stdout.write(`${DIM}  ${summarizeInput(tool.input)}${RESET}\n`);
  }
}

export function printToolResult(tool: string, result: string): void {
  const failed = isFailedResult(result);
  const color = failed ? RED : GREEN;
  const mark = failed ? "✗" : "✓";
  const resultText = result ? ` ${DIM}${result}${RESET}` : "";
  process.stdout.write(`  ${color}${mark} ${tool}${RESET}${resultText}\n`);
}

const FILE_CHANGE_ICONS: Record<"create" | "modify" | "delete", { icon: string; color: string }> = {
  create: { icon: "+", color: GREEN },
  modify: { icon: "✎", color: YELLOW },
  delete: { icon: "✖", color: RED },
};

export function printFileChange(file: string, action: "create" | "modify" | "delete"): void {
  const { icon, color } = FILE_CHANGE_ICONS[action];
  process.stdout.write(`  ${color}${icon} ${file}${RESET}\n`);
}

export function printCommand(cmd: string, output?: string): void {
  process.stdout.write(`${DIM}$ ${cmd}${RESET}\n`);
  if (output) {
    process.stdout.write(`${output}\n`);
  }
}

export function printCompletion(stats: CompletionStats): void {
  const cost = stats.costUsd !== undefined ? `$${stats.costUsd.toFixed(4)}` : "-";
  const summary = `耗时 ${stats.durationMs}ms / 成本 ${cost} / ${stats.turns} 轮`;
  const width = 32;
  const pad = Math.max(0, width - summary.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  process.stdout.write(`\n${DIM}┌${"─".repeat(width)}┐${RESET}\n`);
  process.stdout.write(`${DIM}│${RESET}${" ".repeat(left)}${summary}${" ".repeat(right)}${DIM}│${RESET}\n`);
  process.stdout.write(`${DIM}└${"─".repeat(width)}┘${RESET}\n`);
}
export function printError(text: string): void { process.stdout.write(`\r${RED}✖ ${text}${RESET}\n`); }
export function printWarning(text: string): void { process.stdout.write(`\n${YELLOW}⚠ ${text}${RESET}\n`); }
export function clearStatusLine(): void { process.stdout.write("\r\x1b[K"); }
export function printDownloadProgress(progress: number, message: string): void {
  const pct = Math.round(progress * 100);
  const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r\x1b[K${YELLOW}⬇ ${bar} ${pct}% ${message}${RESET}`);
}

/** 处理编辑模式的按键输入，返回新的缓冲区状态和动作 */
export function processEditKey(buffer: string, chunk: Buffer): { buffer: string; action: "confirm" | "cancel" | "continue" } {
  // Enter (CR or LF)
  if (chunk.includes(0x0d) || chunk.includes(0x0a)) {
    return { buffer, action: "confirm" };
  }

  // Esc
  if (chunk.includes(0x1b)) {
    return { buffer: "", action: "cancel" };
  }

  // Backspace: DEL (0x7f) or BS (0x08)
  if (chunk.includes(0x7f) || chunk.includes(0x08)) {
    if (buffer.length === 0) return { buffer: "", action: "continue" };
    // Remove last character (handles UTF-8 properly)
    return { buffer: buffer.slice(0, -1), action: "continue" };
  }

  // Regular printable characters - append to buffer
  const text = chunk.toString("utf-8");
  if (text.length > 0) {
    // Filter out control characters but keep printable chars including unicode
    const printable = text.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
    if (printable.length > 0) {
      return { buffer: buffer + printable, action: "continue" };
    }
  }

  return { buffer, action: "continue" };
}

/** 显示识别文本并等待用户确认/编辑，返回最终文本或 null（取消） */
export async function promptEditRecognition(text: string): Promise<string | null> {
  let buffer = text;

  // Print initial prompt
  const render = () => {
    process.stdout.write(`\r\x1b[K${GREEN}🎤 ${buffer}${RESET} ${DIM}(Enter 发送 / Esc 取消 / 输入修改)${RESET}`);
  };
  render();

  // Setup raw mode
  const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  return new Promise<string | null>((resolve) => {
    const onData = (chunk: Buffer) => {
      const result = processEditKey(buffer, chunk);
      buffer = result.buffer;

      if (result.action === "confirm") {
        cleanup();
        process.stdout.write("\n");
        resolve(buffer);
      } else if (result.action === "cancel") {
        cleanup();
        process.stdout.write(`\r\x1b[K${DIM}已取消${RESET}\n`);
        resolve(null);
      } else {
        render();
      }
    };

    const cleanup = () => {
      process.stdin.off("data", onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
    };

    process.stdin.on("data", onData);
  });
}

/** 创建 console UI 实现（符合 UI 接口） */
export function createConsoleUI(): UI {
  return {
    printStatus,
    printRecognition,
    printAssistantDelta,
    printToolLine,
    printToolCall,
    printToolResult,
    printFileChange,
    printCommand,
    printCompletion,
    printError,
    printWarning,
    clearStatusLine,
    printDownloadProgress,
    promptEditRecognition,
  };
}
