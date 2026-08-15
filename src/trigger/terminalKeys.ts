import { appendFileSync } from "fs";
import { join } from "path";

const LOG_FILE = join(process.cwd(), "voxcode-debug.log");
function log(msg: string) {
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

export type KeyAction = { kind: "toggle" } | { kind: "cancel" };

/**
 * 解析终端原始输入中的按键序列。
 * F9 在不同终端中可能为：
 *   - ESC [ 2 0 ~（xterm / PowerShell / Windows Terminal）
 *   - ESC [ 1 8 ~（部分 Linux 终端）
 * Esc 为单个 ESC(0x1b)。
 */
export function feedTerminalInput(chunk: string): KeyAction[] {
  log(`terminalKeys parsing chunk: ${JSON.stringify(chunk)} (length=${chunk.length})`);
  const out: KeyAction[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "" || chunk.charCodeAt(i) === 0x1b) {
      // Check if this is F9: ESC followed by [18~ or [20~
      const remaining = chunk.substring(i + 1);
      if (remaining.startsWith("[18~") || remaining.startsWith("[20~")) {
        log(`detected F9 at position ${i}`);
        out.push({ kind: "toggle" });
        i += 5; // ESC + "[18~" or "[20~" 共 5 个字符
      } else {
        log(`detected isolated ESC at position ${i}, next chars: ${JSON.stringify(chunk.slice(i, i+5))}`);
        out.push({ kind: "cancel" }); // 孤立的 ESC 视为取消
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  log(`terminalKeys actions: ${JSON.stringify(out)}`);
  return out;
}
