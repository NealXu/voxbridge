import { readFileSync } from "node:fs";

export interface Config {
  stt: { model: string; model_dir: string; language: string; python_path: string };
  trigger: { key: string; global: boolean };
  agent: { resume: boolean; systemPrompt: string };
}

const DEFAULTS: Config = {
  stt: { model: "large-v3", model_dir: "D:\\Models\\faster-whisper-large-v3", language: "zh", python_path: ".venv\\Scripts\\python.exe" },
  trigger: { key: "F9", global: true },
  agent: { resume: true, systemPrompt: "" },
};

export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    stt: { ...DEFAULTS.stt, ...(raw.stt ?? {}) },
    trigger: { ...DEFAULTS.trigger, ...(raw.trigger ?? {}) },
    agent: { ...DEFAULTS.agent, ...(raw.agent ?? {}) },
  };
}
