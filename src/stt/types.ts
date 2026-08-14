import type { Config } from "../config.js";

export type SttCommand = { type: "start" } | { type: "stop" } | { type: "quit" };
export type SttEvent =
  | { type: "ready" }
  | { type: "recording" }
  | { type: "result"; text: string; duration_ms: number }
  | { type: "noise" }
  | { type: "error"; message: string }
  | { type: "downloading"; progress: number; message: string }
  | { type: "wake" };
export type SttResult =
  | { kind: "text"; text: string }
  | { kind: "noise" }
  | { kind: "error"; message: string };

export interface SttClient {
  start(): void;
  stop(): Promise<SttResult>;
  cancel(): void;
  quit(): Promise<void>;
  dispose(): Promise<void>;
  waitReady(timeoutMs?: number): Promise<void>;
}
export declare function createSttClient(stt: Config["stt"], cwd: string): SttClient;
