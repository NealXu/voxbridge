export interface SessionCallbacks {
  onTextDelta(text: string): void;
  onToolStart(name: string): void;
  onStatus(status: "sending" | "idle" | "error"): void;
  onDangerousTool?(name: string): void;
}
export type SendResult = { ok: true; sessionId: string } | { ok: false; error: string };
export interface AgentSession {
  send(prompt: string): Promise<SendResult>;
  reset(): void;
}
