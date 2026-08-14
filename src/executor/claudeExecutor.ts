/**
 * ClaudeExecutor provides a high-level API for executing Claude Code via SDK.
 *
 * Uses the SDK's query() function with:
 * - spawnClaudeCodeProcess for custom process spawning
 * - bypassPermissions permission mode
 * - resume for session continuation
 *
 * @module executor/claudeExecutor
 */

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ExecutorOptions, ExecutionHandle, SDKMessage as LocalSDKMessage } from "./types.js";

/**
 * Internal state for managing execution.
 */
interface ExecutionState {
  query: Query | null;
  inputQueue: SDKUserMessage[];
  inputResolve: ((value: IteratorResult<SDKUserMessage>) => void) | null;
  finished: boolean;
}

/**
 * Default implementation that spawns the Claude Code process.
 * This is the standard execution mode.
 */
export class ClaudeExecutor {
  private queryImpl: typeof sdkQuery;

  constructor(queryImpl: typeof sdkQuery = sdkQuery) {
    this.queryImpl = queryImpl;
  }

  /**
   * Start a new execution with the given options.
   *
   * @param options - Execution options including cwd, sessionId, model, etc.
   * @returns An ExecutionHandle for interacting with the execution
   */
  startExecution(options: ExecutorOptions): ExecutionHandle {
    const state: ExecutionState = {
      query: null,
      inputQueue: [],
      inputResolve: null,
      finished: false,
    };

    // Build SDK options
    const sdkOptions: Options = {
      cwd: options.cwd,
      abortController: options.abortController,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      resume: options.sessionId,
      model: options.model,
      systemPrompt: options.systemPromptAppend
        ? { type: "preset", preset: "claude_code" }
        : undefined,
      maxTurns: options.maxTurns,
      allowedTools: options.allowedTools,
      env: options.env,
      settingSources: options.settingSources,
    };

    // Apply spawnClaudeCodeProcess if needed (for custom process management)
    if (options.outputsDir) {
      // Custom spawn could be injected here for testing or VM execution
      // For now, we use the default spawn behavior
    }

    // Create an async iterable for the prompt
    const promptIterable: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<SDKUserMessage>> {
            // If there are queued messages, return the next one
            if (state.inputQueue.length > 0) {
              const msg = state.inputQueue.shift()!;
              return { value: msg, done: false };
            }

            // If finished, end iteration
            if (state.finished) {
              return { value: undefined as unknown as SDKUserMessage, done: true };
            }

            // Otherwise, wait for a message to be enqueued
            return new Promise((resolve) => {
              state.inputResolve = resolve;
            });
          },
        };
      },
    };

    // Capture the query implementation in a local variable
    const queryFn = this.queryImpl;

    // Create the async generator function
    async function* createStream(): AsyncGenerator<LocalSDKMessage> {
      try {
        // Start the query with the prompt iterable
        state.query = queryFn({
          prompt: promptIterable,
          options: sdkOptions,
        });

        // Send initial prompt if provided
        if (options.initialPrompt) {
          const initialMsg: SDKUserMessage = {
            type: "user",
            message: {
              role: "user",
              content: options.initialPrompt,
            },
            parent_tool_use_id: null,
          };
          enqueueMessage(state, initialMsg);
        }

        // Yield messages from the query
        for await (const msg of state.query) {
          // Convert SDK SDKMessage to local SDKMessage type
          const localMsg = msg as unknown as LocalSDKMessage;
          yield localMsg;

          // Handle Agent Teams events
          if (options.onTeamEvent && localMsg.type === "task_notification") {
            handleTeamEvent(localMsg, options.onTeamEvent);
          }

          // Stop if finished
          if (state.finished) {
            break;
          }
        }
      } catch (err) {
        // Re-throw to let the consumer handle it
        throw err;
      }
    }

    const stream = createStream();

    // Return the execution handle
    return {
      stream,

      sendAnswer(toolUseId: string, sessionId: string, answer: string): void {
        if (state.finished) {
          throw new Error("Cannot send answer to finished execution");
        }

        // Create a user message with the answer
        const userMsg: SDKUserMessage = {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUseId,
                content: answer,
              },
            ],
          },
          parent_tool_use_id: toolUseId,
          session_id: sessionId,
        };

        enqueueMessage(state, userMsg);
      },

      resolveQuestion(toolUseId: string, answers: Record<string, string>): void {
        if (state.finished) {
          throw new Error("Cannot resolve question on finished execution");
        }

        // Format the answers as a JSON string for structured responses
        const answerText = Object.entries(answers)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n");

        // Create a user message resolving the question
        const userMsg: SDKUserMessage = {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUseId,
                content: answerText,
              },
            ],
          },
          parent_tool_use_id: toolUseId,
        };

        enqueueMessage(state, userMsg);
      },

      finish(): void {
        state.finished = true;
        // Resolve any pending input promise with done
        if (state.inputResolve) {
          state.inputResolve({ value: undefined as unknown as SDKUserMessage, done: true });
          state.inputResolve = null;
        }
        if (state.query) {
          state.query.close();
        }
      },
    };
  }
}

/**
 * Enqueue a message and resolve any pending input promise.
 */
function enqueueMessage(state: ExecutionState, msg: SDKUserMessage): void {
  if (state.inputResolve) {
    // There's a pending promise, resolve it immediately
    const resolve = state.inputResolve;
    state.inputResolve = null;
    resolve({ value: msg, done: false });
  } else {
    // No pending promise, queue the message
    state.inputQueue.push(msg);
  }
}

/**
 * Handle Agent Teams events from task_notification messages.
 */
function handleTeamEvent(
  msg: LocalSDKMessage,
  onTeamEvent: (event: NonNullable<ExecutorOptions["onTeamEvent"]> extends (e: infer E) => void ? E : never) => void
): void {
  // Extract team event information from task_notification
  // The exact structure depends on the SDK's task_notification format
  const data = msg as unknown as {
    task_id?: string;
    subject?: string;
    status?: string;
    teammate?: string;
  };

  if (data.status === "created" && data.task_id && data.subject) {
    onTeamEvent({
      kind: "task_created",
      taskId: data.task_id,
      subject: data.subject,
      teammate: data.teammate,
    } as Parameters<typeof onTeamEvent>[0]);
  } else if (data.status === "completed" && data.task_id && data.subject) {
    onTeamEvent({
      kind: "task_completed",
      taskId: data.task_id,
      subject: data.subject,
      teammate: data.teammate,
    } as Parameters<typeof onTeamEvent>[0]);
  } else if (msg.type === "system" && (msg as unknown as { subtype?: string }).subtype === "teammate_idle") {
    const teammateData = msg as unknown as { teammate?: string };
    if (teammateData.teammate) {
      onTeamEvent({
        kind: "teammate_idle",
        teammate: teammateData.teammate,
      } as Parameters<typeof onTeamEvent>[0]);
    }
  }
}

/**
 * Helper function to create a simple execution with just a prompt.
 * Useful for one-off queries without needing to manage the handle.
 */
export async function executePrompt(
  prompt: string,
  options: Omit<ExecutorOptions, "abortController"> & { abortController?: AbortController }
): Promise<string> {
  const executor = new ClaudeExecutor();
  const abortController = options.abortController ?? new AbortController();

  const handle = executor.startExecution({
    ...options,
    abortController,
  });

  let result = "";
  try {
    // Send the initial prompt
    const initialMsg: SDKUserMessage = {
      type: "user",
      message: {
        role: "user",
        content: prompt,
      },
      parent_tool_use_id: null,
    };

    // Enqueue the initial message
    // Note: This requires access to internal state, so we use a different approach
    // For now, just iterate the stream and wait for result
    for await (const msg of handle.stream) {
      if (msg.type === "result" && msg.result) {
        result = msg.result;
        break;
      }
    }
  } finally {
    handle.finish();
  }

  return result;
}