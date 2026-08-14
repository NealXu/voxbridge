import type { CompletionStats } from "../executor/index.js";

export interface SessionCallbacks {
  onTextDelta(text: string): void;
  onToolStart(name: string): void;
  onStatus(status: "sending" | "idle" | "error"): void;
  onDangerousTool?(name: string): void;
  /** 工具结果（成功/失败摘要），UI 显示工具调用结果行 */
  onToolResult?(tool: string, result: string): void;
  /** 文件变更（create/modify/delete），UI 显示文件变更行 */
  onFileChange?(file: string, action: "create" | "modify" | "delete"): void;
  /** 命令执行，UI 显示命令行 */
  onCommand?(cmd: string, output?: string): void;
  /** 完成统计（耗时/成本/轮数），UI 显示完成面板 */
  onCompletion?(stats: CompletionStats): void;
}

/** 完成统计（executor 类型，session 层 re-export 避免重复定义） */
export type { CompletionStats };
export type SendResult = { ok: true; sessionId: string } | { ok: false; error: string };
export interface AgentSession {
  send(prompt: string): Promise<SendResult>;
  reset(): void;
}
