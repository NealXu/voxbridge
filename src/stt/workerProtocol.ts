/**
 * Worker 协议类型定义
 *
 * 定义插件化 STT Worker 的通信协议，包括命令和事件的类型规范。
 * 支持向后兼容现有的 protocol.ts。
 */

/**
 * Worker 命令类型
 * TypeScript 端发送给 Python Worker 的指令
 */
export type WorkerCommand =
  | { type: "init"; config: WorkerConfig }
  | { type: "start" }
  | { type: "stop" }
  | { type: "cancel" }
  | { type: "quit" };

/**
 * Worker 配置
 * init 命令携带的配置参数
 */
export interface WorkerConfig {
  /** 引擎类型：whisper, sensevoice, sherpa-onnx 等 */
  engine: string;
  /** 识别语言：zh, en, ja 等 */
  language: string;
  /** 模型目录路径 */
  modelDir?: string;
  /** 模型名称 */
  model?: string;
  /** VAD（语音活动检测）配置 */
  vad?: VadConfig;
  /** 唤醒词配置 */
  wakeWord?: {
    /** 是否启用唤醒词检测 */
    enabled: boolean;
    /** 唤醒词短语 */
    phrase: string;
  };
  /** 引擎特定选项 */
  engineOptions?: Record<string, unknown>;
}

/**
 * VAD 配置
 * 语音活动检测参数
 */
export interface VadConfig {
  /** 检测阈值 */
  threshold?: number;
  /** 最小语音时长（毫秒） */
  minVoiceMs?: number;
  /** 静音 RMS 阈值 */
  silenceRms?: number;
  /** 噪声最大 RMS */
  noiseMaxRms?: number;
  /** 音频块时长（毫秒） */
  chunkMs?: number;
  /** 端点静音检测时长（毫秒） */
  endpointSilenceMs?: number;
}

/**
 * Worker 事件类型
 * Python Worker 发送给 TypeScript 端的通知
 */
export type WorkerEvent =
  | { type: "ready"; engine: string; capabilities: WorkerCapabilities }
  | { type: "recording" }
  | { type: "result"; text: string; duration_ms: number; is_final?: boolean }
  | { type: "partial"; text: string }
  | { type: "noise" }
  | { type: "error"; code?: string; message: string; recoverable: boolean }
  | { type: "downloading"; progress: number; message: string }
  | { type: "wake"; phrase?: string; heard?: string };

/**
 * Worker 能力描述
 * Worker 启动时报告的支持功能
 */
export interface WorkerCapabilities {
  /** 是否支持流式识别 */
  streaming: boolean;
  /** 是否支持唤醒词检测 */
  wakeWord: boolean;
  /** 支持的语言列表 */
  languages: string[];
  /** 是否提供置信度分数 */
  confidence: boolean;
  /** 是否提供词级时间戳 */
  wordTimestamps: boolean;
}

/**
 * 编码命令为 JSONL 格式
 *
 * @param cmd - Worker 命令对象
 * @returns 单行 JSON 字符串（以换行结尾）
 *
 * @example
 * ```ts
 * encodeCommand({ type: "start" }); // '{"type":"start"}\n'
 * encodeCommand({ type: "init", config: { engine: "whisper", language: "zh" } });
 * ```
 */
export function encodeCommand(cmd: WorkerCommand): string {
  // 使用 ensure_ascii=false 等效的 JSON.stringify
  // 保持中文字符原样输出，不转义为 Unicode
  return JSON.stringify(cmd) + "\n";
}

/**
 * 解析事件从 JSONL 格式
 *
 * @param line - 单行 JSON 字符串
 * @returns Worker 事件对象
 * @throws {SyntaxError} JSON 解析错误
 *
 * @example
 * ```ts
 * parseEvent('{"type":"result","text":"你好","duration_ms":800}');
 * // { type: "result", text: "你好", duration_ms: 800 }
 * ```
 */
export function parseEvent(line: string): WorkerEvent {
  const e = JSON.parse(line);

  // 确保 result 事件包含必需字段
  if (e.type === "result") {
    return {
      type: "result",
      text: e.text,
      duration_ms: e.duration_ms,
      ...(e.is_final !== undefined && { is_final: e.is_final }),
    };
  }

  // 确保 error 事件包含 recoverable 字段
  if (e.type === "error") {
    return {
      type: "error",
      message: e.message,
      recoverable: e.recoverable ?? false,
      ...(e.code !== undefined && { code: e.code }),
    };
  }

  // 确保 ready 事件包含 capabilities
  if (e.type === "ready") {
    return {
      type: "ready",
      engine: e.engine,
      capabilities: {
        streaming: e.capabilities?.streaming ?? false,
        wakeWord: e.capabilities?.wakeWord ?? false,
        languages: e.capabilities?.languages ?? ["zh"],
        confidence: e.capabilities?.confidence ?? false,
        wordTimestamps: e.capabilities?.wordTimestamps ?? false,
      },
    };
  }

  // 其他事件直接返回
  return e as WorkerEvent;
}