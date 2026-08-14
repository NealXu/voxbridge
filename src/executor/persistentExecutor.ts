/**
 * Persistent executor for the ExecutorRegistry process pool.
 *
 * A persistent executor owns a long-running Claude Code process and an
 * input queue that survives across conversation turns, so a chat can be
 * resumed without respawning the process for every prompt.
 *
 * {@link PersistentClaudeExecutor} runs a long-lived consume loop over its
 * SDK query stream. The stream is fed from an internal
 * {@link AsyncQueue} of user messages so the process stays alive across
 * turns. Each user turn (via {@link PersistentClaudeExecutor.nextTurn})
 * returns a `TurnHandle`; activity that arrives outside a user turn is
 * classified and re-emitted as `spontaneous`, `continuation-turn`, or
 * `between-turn-question` events for the host to act on.
 *
 * @module executor/persistentExecutor
 */

import { EventEmitter } from "node:events";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "./inputQueue.js";
import type { SDKMessage } from "./types.js";

/**
 * The lifecycle surface the process pool needs from an executor.
 *
 * The registry is deliberately typed against this minimal interface so
 * the pool stays decoupled from the SDK and easy to test with fakes.
 */
export interface PersistentExecutorLike {
  /** Chat / conversation key this executor is bound to. */
  readonly chatId: string;
  /** Working directory the process runs in. */
  readonly cwd: string;
  /** Timestamp (ms) when the executor was created. */
  readonly createdAt: number;
  /** Async queue for cross-turn user input. */
  readonly queue: AsyncQueue<string>;
  /** True once {@link shutdown} has been called. */
  readonly isDisposed: boolean;
  /** Enqueue a user message for the next turn. */
  send(message: string): void;
  /** Gracefully stop the executor, finishing its input queue. */
  shutdown(reason: string): Promise<void>;
}

/** Signature of the SDK `query()` entry point, injectable for tests. */
export type PersistentQueryImpl = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;

/** Options for constructing a persistent executor. */
export interface PersistentExecutorOptions {
  /** Chat / conversation key this executor is bound to. */
  chatId: string;
  /** Working directory the process runs in. */
  cwd: string;
  /**
   * SDK query implementation. Defaults to the real `@anthropic-ai/claude-agent-sdk`
   * `query()`; injected in tests to drive the consume loop deterministically.
   */
  queryImpl?: PersistentQueryImpl;
}

/**
 * Handle for a single user turn of a persistent conversation.
 *
 * The handle's {@link TurnHandle.stream} yields every SDK message routed to
 * this turn and ends when the turn's `result` message arrives (or the turn
 * is finished early). `sendAnswer` / `resolveQuestion` feed `tool_result`
 * messages back to the running process; `finish` abandons the turn.
 */
export interface TurnHandle {
  /** Async generator yielding the messages of this turn, ending with its result. */
  stream: AsyncGenerator<SDKMessage, void, unknown>;
  /**
   * Send the answer for a pending tool use back to the process.
   *
   * @param toolUseId - The ID of the tool use to answer
   * @param sessionId - The session ID
   * @param answer - The answer text
   * @throws If the executor has been shut down
   */
  sendAnswer(toolUseId: string, sessionId: string, answer: string): void;
  /**
   * Resolve a question asked mid-turn with multiple answers.
   *
   * @param toolUseId - The ID of the tool use asking the question
   * @param answers - Map of question keys to answer values
   * @throws If the executor has been shut down
   */
  resolveQuestion(toolUseId: string, answers: Record<string, string>): void;
  /** Abandon this turn, ending its stream without waiting for a result. */
  finish(): void;
}

/** Internal clock for one in-flight user turn. */
interface Turn {
  /** Messages routed to this turn while it is active. */
  readonly queue: AsyncQueue<SDKMessage>;
  /** Stream the caller consumes; ends when the turn finishes. */
  readonly stream: AsyncGenerator<SDKMessage, void, unknown>;
}

/** Create a turn with a pre-built stream over its internal queue. */
function createTurn(): Turn {
  const queue = new AsyncQueue<SDKMessage>();
  const stream = (async function* () {
    for await (const message of queue) {
      yield message;
    }
  })();
  return { queue, stream };
}

/** Distinguish the two wire forms of a background-task notification. */
function isTaskNotification(message: SDKMessage): boolean {
  return (
    message.type === "task_notification" ||
    (message.type === "system" && message.subtype === "task_notification")
  );
}

/** Distinguish messages asking the user a question. */
function isQuestion(message: SDKMessage): boolean {
  return message.type === "ask_user_question" || message.type === "question";
}

/**
 * Long-lived persistent Claude Code process.
 *
 * Extends {@link EventEmitter} and emits, for activity that arrives outside
 * a user turn:
 * - `spontaneous` — unrelated activity (initialisation, progress, events)
 * - `continuation-turn` — a background task returned via `task_notification`
 * - `between-turn-question` — Claude asked a question between user turns
 *
 * The loop starts lazily on the first {@link nextTurn} so acquiring and
 * pooling an executor never spawns a process by itself.
 */
export class PersistentClaudeExecutor
  extends EventEmitter
  implements PersistentExecutorLike
{
  readonly chatId: string;
  readonly cwd: string;
  readonly createdAt: number;
  readonly queue = new AsyncQueue<string>();

  private readonly queryImpl: PersistentQueryImpl;
  private readonly sdkInput = new AsyncQueue<SDKUserMessage>();
  private readonly abortController = new AbortController();
  private disposed = false;
  private shutdownReason: string | undefined;
  private loopPromise: Promise<void> | null = null;
  private query: Query | null = null;
  private activeTurn: Turn | null = null;
  private lastError: unknown = undefined;

  constructor(options: PersistentExecutorOptions) {
    super();
    this.chatId = options.chatId;
    this.cwd = options.cwd;
    this.createdAt = Date.now();
    this.queryImpl = options.queryImpl ?? (sdkQuery as unknown as PersistentQueryImpl);
  }

  /**
   * Last error surfaced by the consume loop (e.g. the query throwing after
   * an abort), or `undefined` when the loop ended cleanly.
   */
  get error(): unknown {
    return this.lastError;
  }

  /** Human-readable reason passed to the most recent shutdown, if any. */
  get stopReason(): string | undefined {
    return this.shutdownReason;
  }

  /** Whether this executor has been shut down. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Enqueue a user message for the next turn of this process.
   *
   * `send` feeds the public cross-turn {@link queue}; prefer
   * {@link nextTurn} when the caller needs the turn's stream or handle.
   *
   * @param message - The user turn to deliver
   * @throws If the executor has already been shut down
   */
  send(message: string): void {
    if (this.disposed) {
      throw new Error("Cannot send to a disposed executor");
    }
    this.queue.enqueue(message);
  }

  /**
   * Start a user turn and return a handle for that turn.
   *
   * Enqueues `prompt` into the process's SDK input stream, marks the turn
   * as current, and starts the consume loop on first use. The handle's
   * stream resolves when the turn's `result` message arrives (complete or
   * error), yielding every message routed to the turn.
   *
   * @param prompt - The user prompt for this turn
   * @returns A handle for the turn
   * @throws If the executor has already been shut down
   */
  nextTurn(prompt: string): TurnHandle {
    if (this.disposed) {
      throw new Error("Cannot start a turn on a disposed executor");
    }

    const turn = createTurn();
    this.activeTurn = turn;
    this.ensureLoopStarted();

    this.sdkInput.enqueue({
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
    });

    return {
      stream: turn.stream,
      sendAnswer: (toolUseId, sessionId, answer) =>
        this.enqueueToolResult(toolUseId, sessionId, answer),
      resolveQuestion: (toolUseId, answers) => this.enqueueQuestionAnswer(toolUseId, answers),
      finish: () => this.finishTurn(turn),
    };
  }

  /**
   * Shut the process down gracefully.
   *
   * Finishes both input queues, aborts the query to force the CLI to stop,
   * drains whatever the stream still emits, then closes cleanly.
   *
   * @param reason - Human-readable reason, surfaced via the registry logger
   */
  async shutdown(reason: string): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.shutdownReason = reason;

    // Signal "no more input" everywhere: the public queue, the SDK prompt
    // iterable, and the in-flight turn's stream (so a waiting consumer is
    // released even if no result ever arrives).
    this.queue.finish();
    this.finishActiveTurn();
    this.sdkInput.finish();
    this.abortController.abort();

    if (this.loopPromise) {
      await this.loopPromise;
    }
    this.query?.close();
  }

  /**
   * Start the long-lived consume loop on first use.
   *
   * The loop reads from the injected/real query stream and routes each
   * message while draining the SDK input queue in the background.
   */
  private ensureLoopStarted(): void {
    if (this.loopPromise) return;
    this.loopPromise = this.runLoop();
  }

  private buildSdkOptions(): Options {
    return {
      cwd: this.cwd,
      abortController: this.abortController,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
    };
  }

  private async runLoop(): Promise<void> {
    this.query = this.queryImpl({
      prompt: this.sdkInput,
      options: this.buildSdkOptions(),
    });

    try {
      for await (const message of this.query) {
        this.routeMessage(message as SDKMessage);
      }
    } catch (error) {
      // An abort on shutdown is expected; surface anything else for callers.
      if (!this.disposed) {
        this.lastError = error;
      }
    } finally {
      this.finishActiveTurn();
    }
  }

  /**
   * Classify and dispatch a single message from the SDK stream.
   *
   * While a user turn is active every message is routed into that turn's
   * stream, and a `result` message marks the end of the turn. Outside a
   * turn, messages are re-emitted as events so the host can react.
   */
  private routeMessage(message: SDKMessage): void {
    if (this.activeTurn) {
      this.activeTurn.queue.enqueue(message);
      if (message.type === "result") {
        this.finishActiveTurn();
      }
      return;
    }

    if (message.type === "result") {
      // A stray result (e.g. the tail of a shutdown drain) is still activity.
      this.emit("spontaneous", message);
    } else if (isTaskNotification(message)) {
      this.emit("continuation-turn", message);
    } else if (isQuestion(message)) {
      this.emit("between-turn-question", message);
    } else {
      this.emit("spontaneous", message);
    }
  }

  /** End the current turn, releasing its stream. */
  private finishActiveTurn(): void {
    if (!this.activeTurn) return;
    this.activeTurn.queue.finish();
    this.activeTurn = null;
  }

  /** End a specific turn (used by {@link TurnHandle.finish}). */
  private finishTurn(turn: Turn): void {
    if (this.activeTurn === turn) {
      this.activeTurn = null;
    }
    turn.queue.finish();
  }

  /** Enqueue a `tool_result` user message answering a pending tool use. */
  private enqueueToolResult(toolUseId: string, sessionId: string, answer: string): void {
    if (this.disposed) {
      throw new Error("Cannot send answer to a disposed executor");
    }
    this.sdkInput.enqueue({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseId, content: answer }],
      },
      parent_tool_use_id: toolUseId,
      session_id: sessionId,
    });
  }

  /** Enqueue a user message resolving a question with structured answers. */
  private enqueueQuestionAnswer(toolUseId: string, answers: Record<string, string>): void {
    if (this.disposed) {
      throw new Error("Cannot resolve a question on a disposed executor");
    }
    const answerText = Object.entries(answers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    this.sdkInput.enqueue({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseId, content: answerText }],
      },
      parent_tool_use_id: toolUseId,
    });
  }
}