import type { ToolCallInfo, CompletionStats } from "../executor/types.js";

/**
 * UI 抽象接口
 * 定义所有 UI 层必须实现的方法
 */
export interface UI {
  /** 打印状态行（如"就绪"、"录音中…"） */
  printStatus(text: string): void;

  /** 打印识别结果 */
  printRecognition(text: string): void;

  /** 流式打印 Assistant 文本增量 */
  printAssistantDelta(text: string): void;

  /** 打印工具调用行 */
  printToolLine(text: string): void;

  /** 打印工具调用（如 "▶ Write src/foo.py"） */
  printToolCall(tool: ToolCallInfo): void;

  /** 打印工具执行结果（成功/失败） */
  printToolResult(tool: string, result: string): void;

  /** 打印文件变更（create/modify/delete） */
  printFileChange(file: string, action: "create" | "modify" | "delete"): void;

  /** 打印命令执行（如 "$ npm test"） */
  printCommand(cmd: string, output?: string): void;

  /** 打印执行完成统计（耗时 / 成本 / 轮数） */
  printCompletion(stats: CompletionStats): void;

  /** 打印错误消息 */
  printError(text: string): void;

  /** 打印警告消息 */
  printWarning(text: string): void;

  /** 清除状态行 */
  clearStatusLine(): void;

  /** 打印下载进度 */
  printDownloadProgress(progress: number, message: string): void;

  /** 提示用户编辑识别文本，返回编辑后的文本或 null 取消 */
  promptEditRecognition(text: string): Promise<string | null>;
}