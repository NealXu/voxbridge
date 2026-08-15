import { readFileSync } from "node:fs";

export interface Config {
  stt: {
    model: string;
    model_dir: string;
    language: string;
    python_path: string;
    plugin?: "whisper" | "webspeech";
    webspeech?: {
      language?: string;
      port?: number;
      openBrowser?: boolean;
    };
    vad?: {
      /** silero-vad 语音概率阈值（0-1）。 */
      threshold?: number;
      /** 有效语音最短持续时长（毫秒）。 */
      minVoiceMs?: number;
      /** 静音 RMS 阈值（能量 fallback 用）。 */
      silenceRms?: number;
      /** 有声 RMS 阈值（能量 fallback 用）。 */
      noiseMaxRms?: number;
      /** VAD 处理块大小（毫秒）。 */
      chunkMs?: number;
      /** 端点检测：静音超过此时长切分（毫秒）。 */
      endpointSilenceMs?: number;
    };
    /** 唤醒词（可选）。启用后 worker 进入持续识别模式，匹配时发 wake 事件。 */
    wakeWord?: string;
  };
  trigger: {
    key: string;
    global: boolean;
    wakeWord?: {
      enabled: boolean;
      phrase: string;
    };
  };
  agent: { resume: boolean; systemPrompt: string; confirmDangerous: boolean };
  ui?: {
    mode: "console" | "ink";
    /** ink TUI 主题色（默认 "default"）。 */
    theme?: "default" | "high-contrast" | "monochrome";
  };
  executor?: {
    mode?: "sdk" | "pty";
    persistent?: boolean;
    idleTimeoutMs?: number;
    maxConcurrent?: number;
    maxTeammates?: number;
  };
  claude?: {
    path?: string;
    settingsPath?: string;
    appendSystemPrompt?: string;
    model?: string;
  };
  logging?: {
    level?: "debug" | "info" | "warn" | "error" | "fatal";
    dir?: string;
    maxSize?: number;
    maxFiles?: number;
    enableConsole?: boolean;
  };
}

const DEFAULTS: Config = {
  stt: {
    model: "large-v3",
    model_dir: "D:\\Models\\faster-whisper-large-v3",
    language: "zh",
    python_path: ".venv\\Scripts\\python.exe",
    plugin: "whisper",
    webspeech: { language: "zh-CN", port: 18765, openBrowser: true },
    vad: {
      threshold: 0.45,
      minVoiceMs: 200,
      silenceRms: 1e-4,
      noiseMaxRms: 1e-2,
      chunkMs: 32,
      endpointSilenceMs: 800,
    },
  },
  trigger: {
    key: "F9",
    global: true,
    wakeWord: { enabled: false, phrase: "你好小助" }
  },
  agent: { resume: true, systemPrompt: "", confirmDangerous: true },
  ui: { mode: "console", theme: "default" },
  executor: {
    mode: "sdk",
    persistent: true,
    idleTimeoutMs: 1800000,
    maxConcurrent: 5,
    maxTeammates: 10,
  },
  claude: {
    path: "claude",
    settingsPath: "~/.claude/settings.json",
    appendSystemPrompt: "",
  },
  logging: {
    level: "info",
    dir: "~/.voxbridge/logs",
    maxSize: 10 * 1024 * 1024,
    maxFiles: 5,
    enableConsole: false,
  },
};

export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    stt: {
      ...DEFAULTS.stt,
      ...(raw.stt ?? {}),
      webspeech: {
        ...DEFAULTS.stt.webspeech,
        ...(raw.stt?.webspeech ?? {}),
      },
      vad: {
        ...DEFAULTS.stt.vad,
        ...(raw.stt?.vad ?? {}),
      },
      wakeWord: raw.stt?.wakeWord ?? DEFAULTS.stt.wakeWord,
    },
    trigger: {
      ...DEFAULTS.trigger,
      ...(raw.trigger ?? {}),
      wakeWord: {
        ...DEFAULTS.trigger.wakeWord,
        ...(raw.trigger?.wakeWord ?? {}),
      },
    },
    agent: { ...DEFAULTS.agent, ...(raw.agent ?? {}) },
    ui: { ...DEFAULTS.ui, ...(raw.ui ?? {}) },
    executor: {
      ...DEFAULTS.executor,
      ...(raw.executor ?? {}),
    },
    claude: {
      ...DEFAULTS.claude,
      ...(raw.claude ?? {}),
    },
    logging: {
      ...DEFAULTS.logging,
      ...(raw.logging ?? {}),
    },
  };
}
