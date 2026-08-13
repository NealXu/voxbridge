import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function readEnvFrom(file: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return (raw.env ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

/** 合并 cwd/.claude/settings.json 与 ~/.claude/settings.json 的 env 块，项目优先。 */
export function readSettingsEnv(cwd: string): Record<string, string> {
  const user = readEnvFrom(join(homedir(), ".claude", "settings.json"));
  const project = readEnvFrom(join(cwd, ".claude", "settings.json"));
  return { ...user, ...project };
}
