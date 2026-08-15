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
 * 方向键等 CSI 序列（ESC [ A/B/C/D）应被忽略。
 *
 * 用户反馈：按方向键准备编辑时出现错误，因为方向键被错误识别为取消。
 * 修复：只把单字节 ESC 视为取消，忽略方向键等 CSI 序列。
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
      } else if (remaining.startsWith("[")) {
        // CSI 序列（方向键、Home、End 等）：忽略，跳过整个序列
        log?.debug("detected CSI sequence (arrow key etc), ignoring", {
          position: i,
          nextChars: JSON.stringify(chunk.slice(i, i + 5)),
        });
        // 跳过 ESC [ 和后续字符（直到遇到终止符或超过长度）
        i += 2; // ESC [
        while (i < chunk.length && !isCsiTerminator(chunk[i])) {
          i++;
        }
        if (i < chunk.length) i++; // 跳过终止符
      } else if (remaining.length === 0) {
        // 单字节 ESC（孤立 ESC）：取消
        log?.debug("detected isolated ESC (cancel)");
        out.push({ kind: "cancel" });
        i += 1;
      } else {
        // 其他 ESC 序列（如 ESC O P for F1）：忽略
        log?.debug("detected other ESC sequence, ignoring", {
          position: i,
          nextChars: JSON.stringify(chunk.slice(i, i + 5)),
        });
        i += 1; // 跳过 ESC，让后续字符自然处理
      }
    } else {
      i += 1;
    }
  }
  log?.debug("actions", { actions: JSON.stringify(out) });
  return out;
}

/** CSI 序列终止符（方向键以 A/B/C/D 结尾，其他以 @~ 结尾） */
function isCsiTerminator(ch: string): boolean {
  // CSI 序列终止符：@ A-Z a-z ~
  // 方向键：A (上), B (下), C (右), D (左)
  // Home/End：H, F
  // 功能键：0-9 后跟 ~
  const code = ch.charCodeAt(0);
  return (code >= 0x40 && code <= 0x7a) || ch === "~";
}
