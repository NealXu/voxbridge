import { loadConfig } from "../src/config.js";
import { createAgentSession } from "../src/session/agentSession.js";
import * as ui from "../src/ui/console.js";

// 端到端：不经过键盘，用一段文本直发 agent，验证 Agent SDK 会话链路。
// 语音链路在 Task 10 Step 3 用真实 app 验证。
const config = loadConfig("./config.json");
const session = createAgentSession({ config, cwd: process.cwd(), callbacks: {
  onTextDelta: (t) => process.stdout.write(t),
  onToolStart: (n) => ui.printToolLine(`▶ ${n}`),
  onStatus: () => {},
} });
const prompt = process.argv[2] ?? "只回复：ok";
const r = await session.send(prompt);
console.log("\n" + (r.ok ? `[OK] ${r.sessionId}` : `[FAIL] ${r.error}`));
process.exit(r.ok ? 0 : 1);
