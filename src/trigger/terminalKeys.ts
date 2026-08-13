export type KeyAction = { kind: "toggle" } | { kind: "cancel" };

/**
 * 解析终端原始输入中的按键序列。
 * F9 在 xterm 序列中为 ESC [ 1 8 ~，Esc 为单个 ESC(0x1b)。
 */
export function feedTerminalInput(chunk: string): KeyAction[] {
  const out: KeyAction[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "") {
      if (chunk.startsWith("[18~", i)) {
        out.push({ kind: "toggle" });
        i += 5; // "[18~" 共 5 个字符（ESC [ 1 8 ~）
      } else {
        out.push({ kind: "cancel" }); // 孤立的 ESC 视为取消
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return out;
}
