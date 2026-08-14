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
  ui?: { mode: "console" | "ink" };
}

const DEFAULTS: Config = {
  stt: {
    model: "large-v3",
    model_dir: "D:\\Models\\faster-whisper-large-v3",
    language: "zh",
    python_path: ".venv\\Scripts\\python.exe",
    plugin: "whisper",
    webspeech: { language: "zh-CN", port: 18765, openBrowser: true },
  },
  trigger: {
    key: "F9",
    global: true,
    wakeWord: { enabled: false, phrase: "你好小助" }
  },
  agent: { resume: true, systemPrompt: "", confirmDangerous: true },
  ui: { mode: "console" },
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
  };
}
