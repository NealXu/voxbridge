import { query as defaultQuery } from "@anthropic-ai/claude-agent-sdk";
import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";
import { readSettingsEnv } from "../env.js";
import type { Config } from "../config.js";
import type { AgentSession, SendResult, SessionCallbacks } from "./types.js";

export interface AgentSessionOptions {
  config: Config;
  cwd: string;
  callbacks: SessionCallbacks;
  queryImpl?: typeof defaultQuery;
}

export function createAgentSession(opts: AgentSessionOptions): AgentSession {
  const { config, cwd, callbacks } = opts;
  const queryImpl = opts.queryImpl ?? defaultQuery;
  let lastSessionId: string | undefined;

  const baseOptions = {
    includePartialMessages: true,
    env: { ...process.env, ...readSettingsEnv(cwd) },
    permissionMode: "bypassPermissions" as const,
    systemPrompt: config.agent.systemPrompt
      ? config.agent.systemPrompt
      : { type: "preset" as const, preset: "claude_code" as const },
    settingSources: ["user", "project"] as SettingSource[],
    cwd,
  };

  return {
    async send(prompt: string): Promise<SendResult> {
      callbacks.onStatus("sending");
      try {
        const result = queryImpl({
          prompt,
          options: {
            ...baseOptions,
            resume: config.agent.resume ? (lastSessionId ?? undefined) : undefined,
          },
        });
        let sessionId = lastSessionId;
        for await (const msg of result) {
          if (msg.type === "system" && msg.subtype === "init") {
            sessionId = msg.session_id;
          } else if (msg.type === "stream_event") {
            const e = msg.event;
            if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
              callbacks.onTextDelta(e.delta.text);
            } else if (e.type === "content_block_start" && e.content_block.type === "tool_use") {
              callbacks.onToolStart(e.content_block.name);
            }
          } else if (msg.type === "result") {
            if (msg.subtype === "success") {
              lastSessionId = msg.session_id ?? sessionId;
              callbacks.onStatus("idle");
              return { ok: true, sessionId: lastSessionId };
            }
            callbacks.onStatus("error");
            return { ok: false, error: (msg.errors ?? []).join("; ") };
          }
        }
        callbacks.onStatus("error");
        return { ok: false, error: "unexpected end of stream" };
      } catch (err) {
        callbacks.onStatus("error");
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    reset(): void {
      lastSessionId = undefined;
    },
  };
}
