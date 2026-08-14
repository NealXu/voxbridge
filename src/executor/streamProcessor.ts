/**
 * StreamProcessor processes SDK messages and maintains CardState.
 *
 * Handles:
 * - Content block deltas (streaming text)
 * - Tool use events (start/complete)
 * - Result events (completion)
 * - AskUserQuestion events
 *
 * @module executor/streamProcessor
 */

import type {
  SDKMessage,
  CardState,
  ToolCall,
  PendingQuestion,
} from "./types.js";

/**
 * Options for creating a StreamProcessor.
 */
export interface StreamProcessorOptions {
  /** The initial user prompt */
  userPrompt: string;
  /** Callback when a question needs user input */
  onQuestion?: (question: PendingQuestion) => void;
}

/**
 * Processes SDK messages and maintains execution state.
 *
 * Call `processMessage()` for each message from the SDK stream,
 * and use `getCurrentState()` to get the current CardState.
 *
 * @example
 * ```ts
 * const processor = new StreamProcessor({ userPrompt: "Write a hello world" });
 *
 * for await (const message of handle.stream) {
 *   const state = processor.processMessage(message);
 *   renderUI(state);
 * }
 *
 * console.log("Final state:", processor.getCurrentState());
 * ```
 */
export class StreamProcessor {
  private state: CardState;
  private currentToolId: string | null = null;
  private onQuestion?: (question: PendingQuestion) => void;
  private sessionId: string | null = null;

  constructor(options: StreamProcessorOptions) {
    this.state = {
      status: "thinking",
      userPrompt: options.userPrompt,
      responseText: "",
      toolCalls: [],
    };
    this.onQuestion = options.onQuestion;
  }

  /**
   * Process a single SDK message and update state.
   *
   * @param message - The SDK message to process
   * @returns The updated CardState
   */
  processMessage(message: SDKMessage): CardState {
    // Track session ID
    if (message.session_id) {
      this.sessionId = message.session_id;
    }

    const type = message.type;
    const subtype = message.subtype;

    // Handle different message types
    if (type === "system" && subtype === "init") {
      // Session initialized
      this.state.status = "thinking";
    } else if (type === "assistant" && subtype === "content_block_delta") {
      this.handleContentBlockDelta(message);
    } else if (type === "assistant" && subtype === "content_block_start") {
      this.handleContentBlockStart(message);
    } else if (type === "assistant" && subtype === "content_block_stop") {
      this.handleContentBlockStop(message);
    } else if (type === "tool_use") {
      this.handleToolUse(message);
    } else if (type === "tool_result") {
      this.handleToolResult(message);
    } else if (type === "result") {
      this.handleResult(message);
    } else if (type === "error") {
      this.handleError(message);
    } else if (type === "ask_user_question") {
      this.handleAskUserQuestion(message);
    }

    return this.state;
  }

  /**
   * Get the current execution state.
   *
   * @returns The current CardState
   */
  getCurrentState(): CardState {
    return { ...this.state };
  }

  /**
   * Handle streaming text delta from content blocks.
   */
  private handleContentBlockDelta(message: SDKMessage): void {
    const delta = message.event?.delta?.text;
    if (delta) {
      this.state.responseText += delta;
      this.state.status = "running";
    }
  }

  /**
   * Handle start of a content block (may be a tool_use).
   */
  private handleContentBlockStart(message: SDKMessage): void {
    const content = message.message?.content?.[0];
    if (content?.type === "tool_use") {
      this.currentToolId = content.id || null;
      const toolCall: ToolCall = {
        name: content.name || "unknown",
        status: "running",
        input: content.input,
      };
      this.state.toolCalls.push(toolCall);
      this.state.status = "running";
    }
  }

  /**
   * Handle stop of a content block.
   */
  private handleContentBlockStop(_message: SDKMessage): void {
    this.currentToolId = null;
  }

  /**
   * Handle tool_use event (from SDK event type).
   */
  private handleToolUse(message: SDKMessage): void {
    // Check if this is a tool use message from the message content
    const content = message.message?.content?.find(
      (c) => c.type === "tool_use"
    );

    if (content) {
      const existingIndex = this.state.toolCalls.findIndex(
        (t) => t.name === content.name && t.status === "running"
      );

      if (existingIndex === -1) {
        // Add new tool call
        const toolCall: ToolCall = {
          name: content.name || "unknown",
          status: "running",
          input: content.input,
        };
        this.state.toolCalls.push(toolCall);
      }
    }

    this.state.status = "running";
  }

  /**
   * Handle tool_result event.
   */
  private handleToolResult(message: SDKMessage): void {
    // Find the last running tool call and mark it complete
    const lastRunningTool = [...this.state.toolCalls]
      .reverse()
      .find((t) => t.status === "running");

    if (lastRunningTool) {
      lastRunningTool.status = "complete";
      lastRunningTool.result = message.result;
    }

    // Reset to running status
    this.state.status = "running";
  }

  /**
   * Handle final result message (completion or error).
   */
  private handleResult(message: SDKMessage): void {
    // A result with is_error: true (or error subtype) is a failed execution.
    const isFailed = message.is_error === true || message.subtype === "error_during_execution";
    if (isFailed) {
      this.state.status = "error";
      this.state.errorMessage = message.errors?.[0] ?? message.result ?? "Execution failed";
      return;
    }

    this.state.status = "complete";

    if (message.result) {
      this.state.responseText = message.result;
    }

    if (message.duration_ms !== undefined) {
      this.state.durationMs = message.duration_ms;
    }

    if (message.total_cost_usd !== undefined) {
      this.state.costUsd = message.total_cost_usd;
    }
  }

  /**
   * Handle error message.
   */
  private handleError(message: SDKMessage): void {
    this.state.status = "error";
    this.state.errorMessage =
      message.message?.content?.[0]?.text || "Unknown error";
  }

  /**
   * Handle AskUserQuestion event.
   */
  private handleAskUserQuestion(message: SDKMessage): void {
    this.state.status = "waiting_for_input";

    const content = message.message?.content?.[0];
    const pendingQuestion: PendingQuestion = {
      id: message.uuid || `q-${Date.now()}`,
      toolUseId: message.uuid || "",
      question: content?.text || "",
      sessionId: this.sessionId || "",
    };

    if (this.onQuestion) {
      this.onQuestion(pendingQuestion);
    }
  }

  /**
   * Manually set status (for external control like user cancellation).
   *
   * @param status - The new status
   */
  setStatus(status: CardState["status"]): void {
    this.state.status = status;
  }

  /**
   * Set an error message.
   *
   * @param errorMessage - The error message
   */
  setError(errorMessage: string): void {
    this.state.status = "error";
    this.state.errorMessage = errorMessage;
  }

  /**
   * Get the current session ID if available.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }
}

/**
 * Helper to check if a message indicates completion.
 */
export function isCompleteMessage(message: SDKMessage): boolean {
  return message.type === "result";
}

/**
 * Helper to check if a message indicates an error.
 */
export function isErrorMessage(message: SDKMessage): boolean {
  return message.type === "error";
}

/**
 * Helper to check if a message requires user input.
 */
export function isWaitingForInputMessage(message: SDKMessage): boolean {
  return message.type === "ask_user_question";
}