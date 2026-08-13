import type { Config } from "../config.js";

export type SttCommand = { type: "start" } | { type: "stop" } | { type: "quit" };
export type SttEvent =
  | { type: "ready" }
  | { type: "recording" }
  | { type: "result"; text: string; duration_ms: number }
  | { type: "noise" }
  | { type: "error"; message: string };
export type SttResult =
  | { kind: "text"; text: string }
  | { kind: "noise" }
  | { kind: "error"; message: string };

export interface SttClient {
  start(): void;
  stop(): Promise<SttResult>;
  cancel(): void;
  quit(): Promise<void>;
  /** 完整关闭：发送 quit 并等待 worker 退出（超时则 kill 兜底），避免残留孤儿 python.exe。 */
  dispose(): Promise<void>;
  /** 等待 worker 加载完模型并回 ready；收到 error / 意外退出 / 超时则 reject。 */
  waitReady(timeoutMs?: number): Promise<void>;
}
export declare function createSttClient(stt: Config["stt"], cwd: string): SttClient;
