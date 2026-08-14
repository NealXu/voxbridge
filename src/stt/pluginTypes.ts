import type { SttResult } from "./types.js";

/** STT 插件接口。 */
export interface SttPlugin {
  /** 初始化插件（如启动服务器、加载模型等）。 */
  start(): Promise<void>;
  /** 开始录音。 */
  startRecording(): void;
  /** 停止录音并返回识别结果。 */
  stopRecording(): Promise<SttResult>;
  /** 释放资源。 */
  dispose(): Promise<void>;
}

/** 插件配置基类。 */
export interface PluginConfig {
  /** 识别语言。 */
  language: string;
}