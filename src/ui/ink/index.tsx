import type { UI } from "../types.js";

/**
 * 创建 ink UI 实现
 *
 * 注意：ink 是可选依赖，如果没有安装，会回退到 console 模式
 * 这是一个简化实现，主要展示 ink 架构
 */
export function createInkUI(): UI {
  // ink 是可选依赖，动态加载
  // 如果加载失败，回退到 console
  let inkAvailable = false;
  try {
    // 检查 ink 是否可用
    require.resolve("ink");
    inkAvailable = true;
  } catch {
    // ink 未安装，使用简化实现
  }

  if (!inkAvailable) {
    // 回退到 console 输出
    return createFallbackUI();
  }

  // ink 可用时的实现
  // 注意：完整的 ink 实现需要 React 组件和 render
  // 这里提供基本的接口实现
  return {
    printStatus(text: string): void {
      // ink 模式下，状态显示在状态栏组件
      // 简化实现：直接输出
      process.stdout.write(`[ink] ${text}\n`);
    },

    printRecognition(text: string): void {
      process.stdout.write(`[ink] 🎤 ${text}\n`);
    },

    printAssistantDelta(text: string): void {
      process.stdout.write(text);
    },

    printToolLine(text: string): void {
      process.stdout.write(`[ink] └ ${text}\n`);
    },

    printError(text: string): void {
      process.stdout.write(`[ink] ✖ ${text}\n`);
    },

    printWarning(text: string): void {
      process.stdout.write(`[ink] ⚠ ${text}\n`);
    },

    clearStatusLine(): void {
      process.stdout.write("\r\x1b[K");
    },

    printDownloadProgress(progress: number, message: string): void {
      const bar = "█".repeat(Math.floor(progress / 5)) + "░".repeat(20 - Math.floor(progress / 5));
      process.stdout.write(`[ink] [${bar}] ${progress}% ${message}\n`);
    },

    async promptEditRecognition(text: string): Promise<string | null> {
      // ink 的输入组件较复杂，简化实现
      // 完整实现应使用 ink 的 useInput 或 TextInput 组件
      process.stdout.write(`[ink] 编辑识别文本: ${text}\n`);
      return text;
    },
  };
}

/**
 * 回退 UI（当 ink 未安装时）
 */
function createFallbackUI(): UI {
  const RESET = "\x1b[0m";
  const YELLOW = "\x1b[33m";
  const DIM = "\x1b[2m";

  return {
    printStatus(text: string): void {
      process.stdout.write(`\r\x1b[K${YELLOW}[fallback] ${text}${RESET}`);
    },

    printRecognition(text: string): void {
      process.stdout.write(`\r[fallback] 🎤 ${text}\n`);
    },

    printAssistantDelta(text: string): void {
      process.stdout.write(text);
    },

    printToolLine(text: string): void {
      process.stdout.write(`\n${DIM}└ ${text}${RESET}\n`);
    },

    printError(text: string): void {
      process.stdout.write(`\r\x1b[31m[fallback] ✖ ${text}\x1b[0m\n`);
    },

    printWarning(text: string): void {
      process.stdout.write(`\r${YELLOW}[fallback] ⚠ ${text}${RESET}\n`);
    },

    clearStatusLine(): void {
      process.stdout.write("\r\x1b[K");
    },

    printDownloadProgress(progress: number, message: string): void {
      process.stdout.write(`\r[fallback] ${progress}% ${message}`);
    },

    async promptEditRecognition(text: string): Promise<string | null> {
      process.stdout.write(`\r[fallback] 编辑: ${text}\n`);
      return text;
    },
  };
}

// 重新导出 React 组件（仅在 ink 可用时使用）
// 这些导出是可选的，当 ink 未安装时不会被使用
export { StatusBar } from "./StatusBar.js";
export { RecognitionPanel } from "./RecognitionPanel.js";
export { OutputPanel } from "./OutputPanel.js";
export { App } from "./App.js";