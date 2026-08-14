import type { UI } from "./types.js";
import { createConsoleUI } from "./console.js";
import { createInkUI } from "./ink/index.js";

export async function createUI(mode: "console" | "ink" = "console"): Promise<UI> {
  switch (mode) {
    case "ink":
      return createInkUI();
    case "console":
    default:
      return createConsoleUI();
  }
}

export type { UI } from "./types.js";
export type { ToolCallInfo } from "../executor/types.js";
export type { CompletionStats } from "../executor/types.js";
