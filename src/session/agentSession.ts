import { ClaudeExecutor, StreamProcessor } from "../executor/index.js";
import type { SDKMessage } from "../executor/index.js";
import { readSettingsEnv } from "../env.js";
import type { Config } from "../config.js";
import type { AgentSession, SendResult, SessionCallbacks } from "./types.js";
import { isDangerousTool } from "./dangerousTools.js";
import { loadSessionId, saveSessionId, clearSessionId } from "./persistSession.js";

export interface AgentSessionOptions {
  config: Config;
  cwd: string;
  callbacks: SessionCallbacks;
  executor?: ClaudeExecutor;
  sessionFile?: string;
}

export function createAgentSession(opts: AgentSessionOptions): AgentSession {
  const { config, cwd, callbacks } = opts;
  const executor = opts.executor ?? new ClaudeExecutor();
  const sessionFile = opts.sessionFile;

  // Load persisted sessionId at startup
  let lastSessionId: string | undefined = sessionFile ? loadSessionId(sessionFile) : undefined;

  return {
    async send(prompt: string): Promise<SendResult> {
      callbacks.onStatus("sending");
      try {
        const abortController = new AbortController();

        const envVars = { ...process.env, ...readSettingsEnv(cwd) } as Record<string, string>;
        const handle = executor.startExecution({
          cwd,
          abortController,
          initialPrompt: prompt,
          sessionId: config.agent.resume ? (lastSessionId ?? undefined) : undefined,
          systemPromptAppend: config.agent.systemPrompt ?? undefined,
          env: envVars,
          settingSources: ["user", "project"],
        });

        const processor = new StreamProcessor({ userPrompt: prompt });

        let sessionId: string | undefined = lastSessionId;

        for await (const msg of handle.stream) {
          // Process message and get current state
          const state = processor.processMessage(msg as SDKMessage);

          // Update session ID from processor
          const processorSessionId = processor.getSessionId();
          if (processorSessionId) {
            sessionId = processorSessionId;
          }

          // Handle callbacks based on message type
          handleCallbacks(msg as SDKMessage, callbacks, config);

          // Check for completion
          if (state.status === "complete") {
            lastSessionId = sessionId;
            // Persist sessionId after successful send
            if (sessionFile && lastSessionId) {
              saveSessionId(sessionFile, lastSessionId);
            }
            handle.finish();
            callbacks.onStatus("idle");
            // 完成统计（耗时/成本/轮数）
            callbacks.onCompletion?.({
              durationMs: state.durationMs ?? 0,
              costUsd: state.costUsd,
              turns: state.toolCalls.length,
            });
            return { ok: true, sessionId: lastSessionId ?? "" };
          }

          if (state.status === "error") {
            handle.finish();
            callbacks.onStatus("error");
            return { ok: false, error: state.errorMessage ?? "Unknown error" };
          }
        }

        // Stream ended without completion
        handle.finish();
        callbacks.onStatus("error");
        return { ok: false, error: "unexpected end of stream" };
      } catch (err) {
        callbacks.onStatus("error");
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    reset(): void {
      lastSessionId = undefined;
      // Clear persisted sessionId file
      if (sessionFile) {
        clearSessionId(sessionFile);
      }
    },
  };
}

/**
 * Handle callbacks from SDK messages.
 */
function handleCallbacks(
  msg: SDKMessage,
  callbacks: SessionCallbacks,
  config: Config
): void {
  const type = msg.type;
  const subtype = msg.subtype;
  const eventType = msg.event?.type;

  // Handle text delta streaming — two SDK shapes are seen in the wild:
  //   a) { type: "assistant", subtype: "content_block_delta", event: { delta: { text } } }
  //   b) { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } }
  const isTextDelta =
    (type === "assistant" && subtype === "content_block_delta") ||
    (type === "stream_event" && eventType === "content_block_delta");
  if (isTextDelta) {
    const delta = msg.event?.delta?.text;
    if (delta) {
      callbacks.onTextDelta(delta);
    }
  }

  // Handle tool use start
  const isToolStart =
    (type === "assistant" && subtype === "content_block_start") ||
    (type === "stream_event" && eventType === "content_block_start");
  if (isToolStart) {
    // stream_event carries the block in event.content_block; assistant messages carry it in message.content.
    const content = (type === "stream_event" ? msg.event?.content_block : msg.message?.content?.[0])
      ?? msg.message?.content?.[0];
    if (content && content.type === "tool_use") {
      const toolName = content.name || "unknown";
      callbacks.onToolStart(toolName);
      if (config.agent.confirmDangerous && isDangerousTool(toolName) && callbacks.onDangerousTool) {
        callbacks.onDangerousTool(toolName);
      }
      // 工具调用详情 → 文件变更 / 命令执行
      const input = content.input as Record<string, unknown> | undefined;
      if (callbacks.onFileChange) {
        const filePath = typeof input?.path === "string" ? input.path : undefined;
        if (filePath) {
          const action = input?.content !== undefined ? "create" : "modify";
          callbacks.onFileChange(filePath, action);
        }
      }
      if (callbacks.onCommand && toolName === "Bash") {
        const cmd = typeof input?.command === "string" ? input.command : undefined;
        if (cmd) callbacks.onCommand(cmd);
      }
    }
  }

  // Handle tool_result → onToolResult
  if (type === "tool_result") {
    const resultText = typeof msg.result === "string" ? msg.result : "";
    if (callbacks.onToolResult) {
      callbacks.onToolResult("tool", resultText || "(completed)");
    }
  }
}