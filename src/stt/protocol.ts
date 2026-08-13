import type { SttCommand, SttEvent } from "./types.js";
export function encodeCommand(cmd: SttCommand): string {
  return JSON.stringify(cmd) + "\n";
}
export function parseEvent(line: string): SttEvent {
  const e = JSON.parse(line);
  if (e.type === "result") return { type: "result", text: e.text, duration_ms: e.duration_ms };
  return e as SttEvent;
}
