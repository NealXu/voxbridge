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

/** 渲染编辑提示的两行格式（识别文本 + 操作提示）
 * 光标通过 ANSI 相对定位到文本行内（上移两行 + 移动列）
 */
export function renderEditPrompt(text: string, cursor: number): string {
  // 第一行：🎤 文本内容
  // 第二行：操作提示
  // 光标通过相对定位：先输出两行，然后上移两行并移动到正确列

  const line1 = `${GREEN}🎤 ${text}${RESET}`;
  const line2 = `${DIM}(Enter 发送 / Esc 取消 / Ctrl+U 清空 / 方向键移动)${RESET}`;

  // 光标定位：使用相对移动
  // 1. 输出文本行 + 提示行（各带换行）
  // 2. 上移两行：\x1b[2A（从当前位置到文本行）
  // 3. 移动到列：\x1b[${col}G（1-indexed）
  // "🎤 " = 🎤(2字符宽) + 空格(1字符宽) = 3 显示宽度
  // 文本从第 4 列开始（ANSI 从 1 开始计数）
  // 光标在第 cursor 个字符处，位置 = 3 + cursor + 1 = 4 + cursor
  const cursorCol = 4 + cursor; // "🎤 " = 3 显示宽度 + 1(ANSI起点) = 4
  const cursorSeq = `\x1b[2A\x1b[${cursorCol}G`;

  // 渲染：先输出两行，然后光标定位到文本行
  return `${line1}\n${line2}\n${cursorSeq}`;
}

/** 处理编辑模式的按键输入，返回新的缓冲区状态和动作
 * @param buffer 当前文本内容
 * @param chunk 按键字节
 * @param hasEdited 是否已编辑（首次输入替换，后续插入）
 * @param cursor 当前光标位置（默认为文本末尾）
 */
export function processEditKey(
  buffer: string,
  chunk: Buffer,
  hasEdited: boolean,
  cursor?: number
): { buffer: string; action: "confirm" | "cancel" | "continue"; hasEdited: boolean; cursor: number } {
  // 默认光标在末尾
  const currentCursor = cursor ?? buffer.length;

  // Enter (CR or LF)
  if (chunk.includes(0x0d) || chunk.includes(0x0a)) {
    return { buffer, action: "confirm", hasEdited, cursor: currentCursor };
  }

  // Esc: 只把单字节的 ESC (0x1b) 视为取消
  if (chunk.length === 1 && chunk[0] === 0x1b) {
    return { buffer: "", action: "cancel", hasEdited, cursor: 0 };
  }

  // Ctrl+U: clear buffer (NAK = 0x15)
  if (chunk.includes(0x15)) {
    return { buffer: "", action: "continue", hasEdited: true, cursor: 0 };
  }

  // Arrow keys: CSI sequences ESC [ A/B/C/D
  // 上箭头 ESC [ A (0x1b 0x5b 0x41) - 忽略（未来可用于历史）
  // 下箭头 ESC [ B (0x1b 0x5b 0x42) - 忽略
  // 右箭头 ESC [ C (0x1b 0x5b 0x43) - 光标右移
  // 左箭头 ESC [ D (0x1b 0x5b 0x44) - 光标左移
  if (chunk.length >= 3 && chunk[0] === 0x1b && chunk[1] === 0x5b) {
    const dir = chunk[2];
    if (dir === 0x44) { // 左箭头 D
      const newCursor = Math.max(0, currentCursor - 1);
      return { buffer, action: "continue", hasEdited, cursor: newCursor };
    }
    if (dir === 0x43) { // 右箭头 C
      const newCursor = Math.min(buffer.length, currentCursor + 1);
      return { buffer, action: "continue", hasEdited, cursor: newCursor };
    }
    // 上/下箭头或其他：忽略
    return { buffer, action: "continue", hasEdited, cursor: currentCursor };
  }

  // Backspace: DEL (0x7f) or BS (0x08) - 删除光标前字符
  if (chunk.includes(0x7f) || chunk.includes(0x08)) {
    if (currentCursor === 0) {
      return { buffer, action: "continue", hasEdited, cursor: 0 };
    }
    // 删除光标前的字符
    const newBuffer = buffer.slice(0, currentCursor - 1) + buffer.slice(currentCursor);
    return { buffer: newBuffer, action: "continue", hasEdited: true, cursor: currentCursor - 1 };
  }

  // Regular printable characters - insert at cursor position
  const text = chunk.toString("utf-8");
  if (text.length > 0) {
    // Filter out control characters but keep printable chars including unicode
    const printable = text.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
    if (printable.length > 0) {
      let newBuffer: string;
      let newCursor: number;
      if (!hasEdited) {
        // 第一次输入：替换整个内容
        newBuffer = printable;
        newCursor = printable.length;
      } else {
        // 后续输入：插入到光标位置
        newBuffer = buffer.slice(0, currentCursor) + printable + buffer.slice(currentCursor);
        newCursor = currentCursor + printable.length;
      }
      return { buffer: newBuffer, action: "continue", hasEdited: true, cursor: newCursor };
    }
  }

  // 忽略其他按键
  return { buffer, action: "continue", hasEdited, cursor: currentCursor };
}

/** 显示识别文本并等待用户确认/编辑，返回最终文本或 null（取消） */
export async function promptEditRecognition(text: string): Promise<string | null> {
  let buffer = text;
  let hasEdited = false;
  let cursor = buffer.length; // 光标初始在末尾

  // Render two-line format: text + hints, cursor positioned via ANSI
  const render = () => {
    // Clear previous content (2 lines) and render new
    process.stdout.write(`\r\x1b[K\x1b[1A\x1b[K`); // Clear up to 2 lines
    process.stdout.write(renderEditPrompt(buffer, cursor));
  };

  // Initial render
  process.stdout.write("\r\x1b[K");
  process.stdout.write(renderEditPrompt(buffer, cursor));

  // Setup raw mode
  const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  return new Promise<string | null>((resolve) => {
    const onData = (chunk: Buffer) => {
      const result = processEditKey(buffer, chunk, hasEdited, cursor);
      buffer = result.buffer;
      hasEdited = result.hasEdited;
      cursor = result.cursor;

      if (result.action === "confirm") {
        cleanup();
        process.stdout.write("\n");
        resolve(buffer);
      } else if (result.action === "cancel") {
        cleanup();
        // 清除编辑界面，不显示"已取消"（由调用方处理）
        process.stdout.write(`\r\x1b[K\x1b[1A\x1b[K`);
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
