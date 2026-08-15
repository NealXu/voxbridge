import { ClaudeExecutor, StreamProcessor } from "../executor/index.js";
import type { SDKMessage } from "../executor/index.js";
import { readSettingsEnv } from "../env.js";
import type { Config } from "../config.js";
import type { AgentSession, SendResult, SessionCallbacks } from "./types.js";
import { isDangerousTool } from "./dangerousTools.js";
import { loadSession, saveSessionId, clearSessionId } from "./persistSession.js";
import type { Logger } from "../logger/index.js";

export interface AgentSessionOptions {
  config: Config;
  cwd: string;
  callbacks: SessionCallbacks;
  executor?: ClaudeExecutor;
  sessionFile?: string;
  logger?: Logger;
}

/**
 * 判定 SDK 错误是否为"会话续接失败"——即 resume 的 sessionId 已过期/不存在。
 *
 * Claude Agent SDK 在 resume 失败时通常以 result error 返回，subtype 含 "session" 或
 * 消息含 "session not found" / "not found"。这里用宽松匹配，避免误判其他业务错误。
 */
function isResumeFailure(msg: SDKMessage): boolean {
  if (msg.type !== "result") return false;
  const subtype = (msg as { subtype?: string }).subtype ?? "";
  const errors = (msg as { errors?: unknown[] }).errors;
  const errText = Array.isArray(errors) ? errors.join(" ") : "";
  const combined = `${subtype} ${errText}`.toLowerCase();
  return (
    combined.includes("session") &&
    (combined.includes("not found") ||
      combined.includes("expired") ||
      combined.includes("invalid") ||
      combined.includes("error_reading_session"))
  );
}

export function createAgentSession(opts: AgentSessionOptions): AgentSession {
  const { config, cwd, callbacks } = opts;
  const executor = opts.executor ?? new ClaudeExecutor();
  const sessionFile = opts.sessionFile;
  const log = opts.logger?.child("session");

  // Load persisted sessionId at startup — 使用 loadSession 检查过期
  let lastSessionId: string | undefined;
  if (sessionFile) {
    const result = loadSession(sessionFile);
    if (result.kind === "valid") {
      lastSessionId = result.sessionId;
      log?.info("resuming session", { sessionId: lastSessionId, updatedAt: result.updatedAt });
    } else if (result.kind === "expired") {
      log?.warn("session expired, starting new", {
        updatedAt: result.updatedAt,
        ageMs: result.ageMs,
      });
      clearSessionId(sessionFile);
    } else {
      log?.info("starting new session");
    }
  } else {
    log?.info("starting new session");
  }

  /**
   * 单次执行封装。resume 失败时由 send() 调用方决定是否清空 sessionId 重试。
   */
  async function sendOnce(
    prompt: string,
    effectiveSessionId: string | undefined,
  ): Promise<SendResult & { resumeFailed?: boolean }> {
    callbacks.onStatus("sending");
    try {
      const abortController = new AbortController();

      const envVars = { ...process.env, ...readSettingsEnv(cwd) } as Record<string, string>;
      log?.info("send start", { promptLen: prompt.length, resume: !!effectiveSessionId });
      const handle = executor.startExecution({
        cwd,
        abortController,
        initialPrompt: prompt,
        sessionId: effectiveSessionId,
        systemPromptAppend: config.agent.systemPrompt ?? undefined,
        env: envVars,
        settingSources: ["user", "project"],
      });

      const processor = new StreamProcessor({ userPrompt: prompt });

      let sessionId: string | undefined = lastSessionId;
      let firstMessage = true;

      for await (const msg of handle.stream) {
        // 检查首条消息是否为 resume 失败
        if (firstMessage) {
          firstMessage = false;
          if (effectiveSessionId && isResumeFailure(msg as SDKMessage)) {
            handle.finish();
            log?.warn("resume failed, will retry with new session", {
              attemptedSessionId: effectiveSessionId,
            });
            return { ok: false, error: "session resume failed", resumeFailed: true };
          }
        }

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
          log?.info("send complete", {
            sessionId: lastSessionId,
            durationMs: state.durationMs,
            costUsd: state.costUsd,
            turns: state.toolCalls.length,
          });
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
          log?.error("send error", { error: state.errorMessage });
          return { ok: false, error: state.errorMessage ?? "Unknown error" };
        }
      }

      // Stream ended without completion
      handle.finish();
      callbacks.onStatus("error");
      log?.error("stream ended without completion");
      return { ok: false, error: "unexpected end of stream" };
    } catch (err) {
      callbacks.onStatus("error");
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error("send threw", { error: errMsg });
      return { ok: false, error: errMsg };
    }
  }

  return {
    async send(prompt: string): Promise<SendResult> {
      const effectiveSessionId = config.agent.resume ? (lastSessionId ?? undefined) : undefined;
      const result = await sendOnce(prompt, effectiveSessionId);

      // Resume 失败自动回退：清空 sessionId 并用新会话重试一次
      if (result.resumeFailed && effectiveSessionId) {
        if (sessionFile) clearSessionId(sessionFile);
        lastSessionId = undefined;
        callbacks.onSessionFallback?.(effectiveSessionId);
        return await sendOnce(prompt, undefined);
      }

      return result;
    },
    reset(): void {
      log?.info("session reset", { previousSessionId: lastSessionId });
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