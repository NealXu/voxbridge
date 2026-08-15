import type { Logger } from "../logger/index.js";

/** 模块级 logger（由 trigger/index.ts 在启动时注入）。 */
let log: Logger | undefined;

/** 注入 logger（应用启动时调用一次）。 */
export function setTerminalKeysLogger(logger: Logger): void {
  log = logger.child("trigger.keys");
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
  log?.debug("parsing chunk", { chunkJson: JSON.stringify(chunk), chunkLen: chunk.length });
  const out: KeyAction[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "" || chunk.charCodeAt(i) === 0x1b) {
      // Check if this is F9: ESC followed by [18~ or [20~
      const remaining = chunk.substring(i + 1);
      if (remaining.startsWith("[18~") || remaining.startsWith("[20~")) {
        log?.debug("detected F9", { position: i });
        out.push({ kind: "toggle" });
        i += 5; // ESC + "[18~" or "[20~" 共 5 个字符
      } else {
        log?.debug("detected isolated ESC", {
          position: i,
          nextChars: JSON.stringify(chunk.slice(i, i + 5)),
        });
        out.push({ kind: "cancel" }); // 孤立的 ESC 视为取消
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  log?.debug("actions", { actions: JSON.stringify(out) });
  return out;
}
