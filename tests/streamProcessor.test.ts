import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StreamProcessor,
  isCompleteMessage,
  isErrorMessage,
  isWaitingForInputMessage,
} from "../src/executor/streamProcessor.js";
import type { SDKMessage } from "../src/executor/types.js";

test("StreamProcessor initializes with user prompt", () => {
  const processor = new StreamProcessor({ userPrompt: "Write hello world" });
  const state = processor.getCurrentState();

  assert.equal(state.status, "thinking");
  assert.equal(state.userPrompt, "Write hello world");
  assert.equal(state.responseText, "");
  assert.deepEqual(state.toolCalls, []);
});

test("StreamProcessor accumulates text deltas", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  // First delta
  const msg1: SDKMessage = {
    type: "assistant",
    subtype: "content_block_delta",
    event: { type: "text_delta", delta: { text: "Hello" } },
  };
  processor.processMessage(msg1);

  // Second delta
  const msg2: SDKMessage = {
    type: "assistant",
    subtype: "content_block_delta",
    event: { type: "text_delta", delta: { text: " world" } },
  };
  processor.processMessage(msg2);

  const state = processor.getCurrentState();
  assert.equal(state.responseText, "Hello world");
  assert.equal(state.status, "running");
});

test("StreamProcessor tracks tool calls", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  // Tool use start
  const msg1: SDKMessage = {
    type: "assistant",
    subtype: "content_block_start",
    message: {
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "Bash",
          input: { command: "echo hello" },
        },
      ],
    },
  };
  processor.processMessage(msg1);

  const state = processor.getCurrentState();
  assert.equal(state.toolCalls.length, 1);
  assert.equal(state.toolCalls[0].name, "Bash");
  assert.equal(state.toolCalls[0].status, "running");
  assert.deepEqual(state.toolCalls[0].input, { command: "echo hello" });
});

test("StreamProcessor marks tool complete on result", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  // Start tool
  processor.processMessage({
    type: "assistant",
    subtype: "content_block_start",
    message: {
      content: [{ type: "tool_use", id: "tool-1", name: "Read" }],
    },
  });

  // Tool result
  processor.processMessage({
    type: "tool_result",
    uuid: "tool-1",
    result: "file contents here",
  });

  const state = processor.getCurrentState();
  assert.equal(state.toolCalls[0].status, "complete");
  assert.equal(state.toolCalls[0].result, "file contents here");
});

test("StreamProcessor handles result message with completion stats", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  processor.processMessage({
    type: "result",
    result: "Task completed successfully",
    duration_ms: 5000,
    total_cost_usd: 0.01,
  });

  const state = processor.getCurrentState();
  assert.equal(state.status, "complete");
  assert.equal(state.responseText, "Task completed successfully");
  assert.equal(state.durationMs, 5000);
  assert.equal(state.costUsd, 0.01);
});

test("StreamProcessor handles error messages", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  processor.processMessage({
    type: "error",
    message: {
      content: [{ type: "text", text: "Something went wrong" }],
    },
  });

  const state = processor.getCurrentState();
  assert.equal(state.status, "error");
  assert.equal(state.errorMessage, "Something went wrong");
});

test("StreamProcessor handles ask_user_question", () => {
  let capturedQuestion: unknown = null;

  const processor = new StreamProcessor({
    userPrompt: "test",
    onQuestion: (q) => {
      capturedQuestion = q;
    },
  });

  processor.processMessage({
    type: "ask_user_question",
    uuid: "q-123",
    session_id: "sess-456",
    message: {
      content: [{ type: "text", text: "What is your name?" }],
    },
  });

  const state = processor.getCurrentState();
  assert.equal(state.status, "waiting_for_input");
  assert.ok(capturedQuestion);
  assert.equal((capturedQuestion as { question: string }).question, "What is your name?");
});

test("StreamProcessor tracks session ID", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  processor.processMessage({
    type: "system",
    subtype: "init",
    session_id: "session-abc-123",
  });

  assert.equal(processor.getSessionId(), "session-abc-123");
});

test("StreamProcessor handles multiple tool calls", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  // First tool
  processor.processMessage({
    type: "assistant",
    subtype: "content_block_start",
    message: {
      content: [{ type: "tool_use", id: "t1", name: "Read" }],
    },
  });

  // Second tool
  processor.processMessage({
    type: "assistant",
    subtype: "content_block_start",
    message: {
      content: [{ type: "tool_use", id: "t2", name: "Write" }],
    },
  });

  const state = processor.getCurrentState();
  assert.equal(state.toolCalls.length, 2);
  assert.equal(state.toolCalls[0].name, "Read");
  assert.equal(state.toolCalls[1].name, "Write");
});

test("StreamProcessor handles multiple sequential tool result messages", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  // Two tools started
  processor.processMessage({
    type: "assistant",
    subtype: "content_block_start",
    message: {
      content: [{ type: "tool_use", id: "t1", name: "Read" }],
    },
  });

  processor.processMessage({
    type: "assistant",
    subtype: "content_block_start",
    message: {
      content: [{ type: "tool_use", id: "t2", name: "Bash" }],
    },
  });

  // First tool result - marks the last running tool (Bash) complete
  processor.processMessage({
    type: "tool_result",
    uuid: "t2",
    result: "bash output",
  });

  // Second tool result - marks Read complete
  processor.processMessage({
    type: "tool_result",
    uuid: "t1",
    result: "read output",
  });

  const state = processor.getCurrentState();
  assert.equal(state.toolCalls[0].status, "complete");
  assert.equal(state.toolCalls[1].status, "complete");
});

test("StreamProcessor returns copy of state", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  const state1 = processor.getCurrentState();
  processor.processMessage({
    type: "assistant",
    subtype: "content_block_delta",
    event: { type: "text_delta", delta: { text: "Hello" } },
  });

  // state1 should be unchanged (it's a copy)
  assert.equal(state1.responseText, "");

  const state2 = processor.getCurrentState();
  assert.equal(state2.responseText, "Hello");
});

test("StreamProcessor setStatus allows external control", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  processor.setStatus("error");
  assert.equal(processor.getCurrentState().status, "error");

  processor.setStatus("complete");
  assert.equal(processor.getCurrentState().status, "complete");
});

test("StreamProcessor setError sets error state", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  processor.setError("Custom error message");

  const state = processor.getCurrentState();
  assert.equal(state.status, "error");
  assert.equal(state.errorMessage, "Custom error message");
});

// Helper function tests
test("isCompleteMessage identifies result type", () => {
  assert.ok(isCompleteMessage({ type: "result" }));
  assert.ok(!isCompleteMessage({ type: "assistant" }));
  assert.ok(!isCompleteMessage({ type: "tool_use" }));
});

test("isErrorMessage identifies error type", () => {
  assert.ok(isErrorMessage({ type: "error" }));
  assert.ok(!isErrorMessage({ type: "result" }));
  assert.ok(!isErrorMessage({ type: "assistant" }));
});

test("isWaitingForInputMessage identifies ask_user_question type", () => {
  assert.ok(isWaitingForInputMessage({ type: "ask_user_question" }));
  assert.ok(!isWaitingForInputMessage({ type: "result" }));
  assert.ok(!isWaitingForInputMessage({ type: "error" }));
});

test("StreamProcessor handles empty delta gracefully", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  processor.processMessage({
    type: "assistant",
    subtype: "content_block_delta",
    event: { type: "text_delta" }, // no delta
  });

  assert.equal(processor.getCurrentState().responseText, "");
});

test("StreamProcessor handles tool_use without existing tool call", () => {
  const processor = new StreamProcessor({ userPrompt: "test" });

  // Direct tool_use message (not from content_block_start)
  processor.processMessage({
    type: "tool_use",
    message: {
      content: [{ type: "tool_use", id: "t1", name: "Bash" }],
    },
  });

  const state = processor.getCurrentState();
  assert.equal(state.toolCalls.length, 1);
  assert.equal(state.toolCalls[0].name, "Bash");
  assert.equal(state.toolCalls[0].status, "running");
});

test("StreamProcessor handles full workflow simulation", () => {
  const questions: unknown[] = [];

  const processor = new StreamProcessor({
    userPrompt: "Create a file",
    onQuestion: (q) => questions.push(q),
  });

  // Simulate a full conversation flow
  const messages: SDKMessage[] = [
    { type: "system", subtype: "init", session_id: "sess-1" },
    { type: "assistant", subtype: "content_block_delta", event: { type: "text_delta", delta: { text: "I'll create" } } },
    { type: "assistant", subtype: "content_block_delta", event: { type: "text_delta", delta: { text: " a file" } } },
    { type: "assistant", subtype: "content_block_start", message: { content: [{ type: "tool_use", id: "t1", name: "Write" }] } },
    { type: "tool_result", uuid: "t1", result: "File created" },
    { type: "result", result: "Done", duration_ms: 1000, total_cost_usd: 0.01 },
  ];

  let lastState = processor.getCurrentState();
  for (const msg of messages) {
    lastState = processor.processMessage(msg);
  }

  assert.equal(lastState.status, "complete");
  assert.equal(lastState.responseText, "Done");
  assert.equal(lastState.toolCalls.length, 1);
  assert.equal(lastState.toolCalls[0].name, "Write");
  assert.equal(lastState.toolCalls[0].status, "complete");
  assert.equal(processor.getSessionId(), "sess-1");
});