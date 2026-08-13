import { query } from "@anthropic-ai/claude-agent-sdk";
import { readSettingsEnv } from "../src/env.js";

const env = { ...process.env, ...readSettingsEnv(process.cwd()) };
console.log("用 base URL:", env.ANTHROPIC_BASE_URL, "模型:", env.ANTHROPIC_MODEL);

const result = query({
  prompt: "只回复四个字：连接成功",
  options: {
    includePartialMessages: true,
    env,
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project"],
    permissionMode: "bypassPermissions",
  },
});

let sessionId: string | undefined;
for await (const msg of result) {
  if (msg.type === "system" && msg.subtype === "init") {
    sessionId = msg.session_id;
  } else if (msg.type === "stream_event") {
    const e = msg.event;
    if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
      process.stdout.write(e.delta.text);
    }
  } else if (msg.type === "result") {
    if (msg.subtype === "success") {
      console.log("\n[OK] 会话ID:", msg.session_id ?? sessionId);
      process.exit(0);
    } else {
      console.error("\n[FAIL]", msg.is_error, (msg.errors ?? []).join("; "));
      process.exit(1);
    }
  }
}
