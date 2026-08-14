import React from "react";
import type { UI } from "../types.js";
import { App } from "./App.js";
import { setState, getState, appendOutputLine } from "./store.js";

// ink 是 ESM-only，必须用 import() 加载
let inkModule: typeof import("ink") | null = null;
let loadPromise: Promise<typeof import("ink") | null> | null = null;

function loadInk(): Promise<typeof import("ink") | null> {
  if (loadPromise) return loadPromise;
  loadPromise = import("ink")
    .then((mod) => { inkModule = mod; return mod; })
    .catch(() => { inkModule = null; return null; });
  return loadPromise;
}

// 立即开始加载
loadInk();

/**
 * 创建 ink TUI 实现（异步）
 * 等待 ink 加载完成后渲染 React 组件
 */
export async function createInkUI(): Promise<UI> {
  const ink = await loadInk();

  if (!ink) {
    return createFallbackUI();
  }

  ink.render(React.createElement(App), {
    stdout: process.stdout,
    exitOnCtrlC: false,
  });

  return {
    printStatus(text: string): void {
      setState("status", text);
    },

    printRecognition(text: string): void {
      setState("recognition", `\u{1F3A4} ${text}`);
    },

    printAssistantDelta(text: string): void {
      const lines = getState<string[]>("outputLines");
      if (lines.length === 0) {
        appendOutputLine(text);
      } else {
        const last = lines[lines.length - 1];
        const updated = [...lines.slice(0, -1), last + text];
        setState("outputLines", updated);
      }
    },

    printToolLine(text: string): void {
      appendOutputLine(`└ ${text}`);
    },

    printError(text: string): void {
      appendOutputLine(`✖ ${text}`);
      setState("status", `错误: ${text}`);
    },

    printWarning(text: string): void {
      appendOutputLine(`⚠ ${text}`);
    },

    clearStatusLine(): void {
      setState("recognition", "");
    },

    printDownloadProgress(progress: number, message: string): void {
      const pct = Math.round(progress * 100);
      setState("status", `⬇ 下载中 ${pct}% ${message}`);
    },

    async promptEditRecognition(text: string): Promise<string | null> {
      setState("recognition", `\u{1F3A4} ${text} (Enter 发送)`);
      return text;
    },
  };
}

function createFallbackUI(): UI {
  const YELLOW = "\x1b[33m";
  const RESET = "\x1b[0m";

  return {
    printStatus(text: string): void {
      process.stdout.write(`\r\x1b[K${YELLOW}[ink-fallback] ${text}${RESET}`);
    },
    printRecognition(text: string): void {
      process.stdout.write(`\r\x1b[32m[ink-fallback] \u{1F3A4} ${text}\x1b[0m\n`);
    },
    printAssistantDelta(text: string): void {
      process.stdout.write(text);
    },
    printToolLine(text: string): void {
      process.stdout.write(`\n\x1b[2m└ ${text}\x1b[0m\n`);
    },
    printError(text: string): void {
      process.stdout.write(`\r\x1b[31m[ink-fallback] ✖ ${text}\x1b[0m\n`);
    },
    printWarning(text: string): void {
      process.stdout.write(`\n\x1b[33m[ink-fallback] ⚠ ${text}\x1b[0m\n`);
    },
    clearStatusLine(): void {
      process.stdout.write("\r\x1b[K");
    },
    printDownloadProgress(progress: number, message: string): void {
      const pct = Math.round(progress * 100);
      process.stdout.write(`\r\x1b[K${YELLOW}[ink-fallback] ⬇ ${pct}% ${message}${RESET}`);
    },
    async promptEditRecognition(text: string): Promise<string | null> {
      process.stdout.write(`\r\x1b[32m[ink-fallback] \u{1F3A4} ${text}\x1b[0m\n`);
      return text;
    },
  };
}
