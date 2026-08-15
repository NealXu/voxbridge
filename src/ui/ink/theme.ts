import type { UI } from "../types.js";

export type ThemeName = "default" | "high-contrast" | "monochrome";

export interface Theme {
  status: { ready: string; recording: string; error: string; info: string };
  recognition: string;
  tool: { call: string; result: string; file: string };
  error: string;
  warning: string;
  border: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  default: {
    status: { ready: "green", recording: "yellow", error: "red", info: "cyan" },
    recognition: "green",
    tool: { call: "cyan", result: "gray", file: "gray" },
    error: "red",
    warning: "yellow",
    border: "green",
  },
  "high-contrast": {
    status: { ready: "greenBright", recording: "yellowBright", error: "redBright", info: "white" },
    recognition: "greenBright",
    tool: { call: "cyanBright", result: "white", file: "white" },
    error: "redBright",
    warning: "yellowBright",
    border: "white",
  },
  monochrome: {
    status: { ready: "white", recording: "white", error: "white", info: "white" },
    recognition: "white",
    tool: { call: "white", result: "gray", file: "gray" },
    error: "white",
    warning: "white",
    border: "white",
  },
};

export function resolveTheme(name?: ThemeName): Theme {
  return THEMES[name ?? "default"] ?? THEMES.default;
}

/** 状态栏颜色选择器。 */
export function statusColor(theme: Theme, status: string): string {
  if (status.includes("就绪")) return theme.status.ready;
  if (status.includes("录音")) return theme.status.recording;
  if (status.includes("错误")) return theme.status.error;
  return theme.status.info;
}

export type InkUI = UI;
