import type { UI } from "./types.js";
import { createConsoleUI } from "./console.js";
import { createInkUI } from "./ink/index.js";

/**
 * 创建 UI 实例
 * @param mode UI 模式：console 或 ink
 * @returns UI 实例
 */
export function createUI(mode: "console" | "ink" = "console"): UI {
  switch (mode) {
    case "ink":
      return createInkUI();
    case "console":
    default:
      return createConsoleUI();
  }
}

// 重新导出类型
export type { UI } from "./types.js";