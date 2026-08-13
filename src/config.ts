import { readFileSync } from "node:fs";

export interface Config {
  stt: { plugin: "whisper"; model: string; model_dir: string; language: string; python_path: string };
  trigger: { mode: "push-to-talk"; key: string; global: boolean };
  agent: { resume: boolean; confirmDangerous: boolean; systemPrompt: string };
  ui: { showRecognition: boolean };
}

const DEFAULTS: Config = {
  stt: { plugin: "whisper", model: "large-v3", model_dir: "D:\\Models\\faster-whisper-large-v3", language: "zh", python_path: ".venv\\Scripts\\python.exe" },
  trigger: { mode: "push-to-talk", key: "F9", global: true },
  agent: { resume: true, confirmDangerous: true, systemPrompt: "" },
  ui: { showRecognition: true },
};

export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    stt: { ...DEFAULTS.stt, ...(raw.stt ?? {}) },
    trigger: { ...DEFAULTS.trigger, ...(raw.trigger ?? {}) },
    agent: { ...DEFAULTS.agent, ...(raw.agent ?? {}) },
    ui: { ...DEFAULTS.ui, ...(raw.ui ?? {}) },
  };
}
