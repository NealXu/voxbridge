/**
 * Type definitions for the Claude Code Executor module.
 *
 * These types define the interfaces for SDK-mode execution,
 * stream processing, session management, and Agent Teams support.
 *
 * @module executor/types
 */

/**
 * Represents a message from the Claude Agent SDK JSONL stream.
 *
 * Messages can be of various types including:
 * - Content block deltas (streaming text)
 * - Tool use events
 * - Result events (completion)
 * - Session metadata
 */
export interface SDKMessage {
  /** The primary type of the message (e.g., 'tool_use', 'result') */
  type: string;
  /** Optional subtype for more specific categorization */
  subtype?: string;
  /** Unique identifier for this message */
  uuid?: string;
  /** Session identifier for resuming conversations */
  session_id?: string;
  /** The message content, containing text or tool use information */
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: unknown;
    }>;
  };
  /** Streaming event data for real-time updates */
  event?: {
    type: string;
    delta?: { text?: string };
    content_block?: {
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: unknown;
    };
  };
  /** Whether a result message indicates a failed execution */
  is_error?: boolean;
  /** Error details from a failed execution */
  errors?: string[];
  /** Final result text when execution completes */
  result?: string;
  /** Total execution duration in milliseconds */
  duration_ms?: number;
  /** Total API cost in USD */
  total_cost_usd?: number;
}

/**
 * Options for configuring the Claude Code executor.
 *
 * Controls working directory, session persistence, model selection,
 * and various execution parameters.
 */
export interface ExecutorOptions {
  /** Working directory for Claude Code execution */
  cwd: string;
  /** Existing session ID to resume (optional) */
  sessionId?: string;
  /** Initial prompt to send at the start of execution */
  initialPrompt?: string;
  /** Model to use for this execution (e.g., 'claude-opus-5') */
  model?: string;
  /** Additional system prompt to append */
  systemPromptAppend?: string;
  /** Environment variables to pass to the process */
  env?: Record<string, string>;
  /** Setting sources for configuration */
  settingSources?: Array<"user" | "project" | "local">;
  /** AbortController for cancelling execution */
  abortController: AbortController;
  /** Directory for output files (optional) */
  outputsDir?: string;
  /** Callback for Agent Teams events */
  onTeamEvent?: (event: TeamEvent) => void;
  /** Maximum number of turns (optional) */
  maxTurns?: number;
  /** List of allowed tools (optional) */
  allowedTools?: string[];
}

/**
 * Handle for an ongoing Claude Code execution.
 *
 * Provides access to the message stream and methods to interact
 * with the execution (send answers, resolve questions, finish).
 */
export interface ExecutionHandle {
  /** Async generator yielding SDK messages */
  stream: AsyncGenerator<SDKMessage>;
  /**
   * Send an answer to a pending tool use.
   *
   * @param toolUseId - The ID of the tool use to answer
   * @param sessionId - The session ID
   * @param answer - The answer text
   */
  sendAnswer(toolUseId: string, sessionId: string, answer: string): void;
  /**
   * Resolve a pending question with multiple answers.
   *
   * @param toolUseId - The ID of the tool use asking the question
   * @param answers - Map of question keys to answer values
   */
  resolveQuestion(toolUseId: string, answers: Record<string, string>): void;
  /** Signal that the execution should finish */
  finish(): void;
}

/**
 * Represents the state of an execution card in the UI.
 *
 * Tracks the current status, accumulated response text,
 * tool calls, and execution statistics.
 */
export interface CardState {
  /** Current execution status */
  status: 'thinking' | 'running' | 'waiting_for_input' | 'complete' | 'error';
  /** The original user prompt */
  userPrompt: string;
  /** Accumulated response text from streaming */
  responseText: string;
  /** List of tool calls made during execution */
  toolCalls: ToolCall[];
  /** Error message if status is 'error' */
  errorMessage?: string;
  /** Total execution duration in milliseconds */
  durationMs?: number;
  /** Total API cost in USD */
  costUsd?: number;
}

/**
 * Represents a single tool call during execution.
 *
 * Tracks the tool name, status, input parameters, and result.
 */
export interface ToolCall {
  /** Name of the tool (e.g., 'Write', 'Bash', 'Read') */
  name: string;
  /** Current status of the tool call */
  status: 'running' | 'complete' | 'error';
  /** Input parameters passed to the tool */
  input?: unknown;
  /** Result returned by the tool (when complete) */
  result?: string;
}

/**
 * Event types for Agent Teams coordination.
 *
 * These events are emitted when teammates are created,
 * complete tasks, or become idle.
 */
export type TeamEvent =
  | { kind: 'task_created'; taskId: string; subject: string; teammate?: string; teamName?: string }
  | { kind: 'task_completed'; taskId: string; subject: string; teammate?: string; teamName?: string }
  | { kind: 'teammate_idle'; teammate: string; teamName?: string };

/**
 * Represents the overall state of an Agent Team.
 *
 * Contains information about all teammates and their tasks.
 */
export interface TeamState {
  /** Optional team name */
  name?: string;
  /** List of teammates in the team */
  teammates: TeamMember[];
  /** List of tasks being tracked */
  tasks: TeamTask[];
}

/**
 * Represents a single teammate in an Agent Team.
 *
 * Tracks the teammate's name, current status, and last activity.
 */
export interface TeamMember {
  /** Name/identifier of the teammate */
  name: string;
  /** Current status of the teammate */
  status: 'idle' | 'working';
  /** Subject of the last task they were working on */
  lastSubject?: string;
}

/**
 * Represents a task being executed by a teammate.
 *
 * Tracks the task ID, subject, status, and assigned teammate.
 */
export interface TeamTask {
  /** Unique identifier for the task */
  taskId: string;
  /** Brief description of what the task involves */
  subject: string;
  /** Current status of the task */
  status: 'in_progress' | 'completed';
  /** Name of the teammate assigned to this task (optional) */
  teammate?: string;
}

/**
 * Represents a pending question awaiting user input.
 *
 * Used when Claude Code needs to ask the user for clarification
 * or additional information during execution.
 */
export interface PendingQuestion {
  /** Unique identifier for the question */
  id: string;
  /** The tool use ID that triggered this question */
  toolUseId: string;
  /** The question text to display to the user */
  question: string;
  /** Possible answers or input fields expected */
  answers?: Record<string, string>;
  /** Session ID for context */
  sessionId: string;
}

/**
 * Minimal tool-call info for UI display.
 *
 * A lighter-weight view of a tool call (name + input) used by the
 * UI layer to render a tool-invocation line without needing the
 * full lifecycle status of {@link ToolCall}.
 */
export interface ToolCallInfo {
  /** Name of the tool (e.g., 'Write', 'Bash', 'Read') */
  name: string;
  /** Input parameters passed to the tool (optional) */
  input?: unknown;
}

/**
 * Statistics for a completed execution.
 *
 * Provides summary information about the execution's
 * duration, cost, and turn count.
 */
export interface CompletionStats {
  /** Total execution duration in milliseconds */
  durationMs: number;
  /** Total API cost in USD (if available) */
  costUsd?: number;
  /** Number of conversation turns */
  turns: number;
}