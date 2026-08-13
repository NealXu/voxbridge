import { loadConfig } from "./config.js";
import { createSttClient } from "./stt/index.js";
import { createAgentSession } from "./session/agentSession.js";
import { createTrigger } from "./trigger/index.js";
import type { Trigger } from "./trigger/index.js";
import * as ui from "./ui/console.js";

const config = loadConfig(process.argv[2] ?? "./config.json");
const stt = createSttClient(config.stt, process.cwd());
const session = createAgentSession({ config, cwd: process.cwd(), callbacks: {
  onTextDelta: (t) => ui.printAssistantDelta(t),
  onToolStart: (name) => ui.printToolLine(`▶ ${name}`),
  onStatus: (s) => { if (s === "error") ui.printError("agent 调用失败"); },
} });

async function handleStop() {
  ui.clearStatusLine();
  const result = await stt.stop();
  if (result.kind === "text") {
    ui.printRecognition(result.text);
    const r = await session.send(result.text);
    if (!r.ok) ui.printError(r.error);
    ui.printStatus(`就绪，按 ${config.trigger.key} 说话`);
  } else if (result.kind === "noise") {
    ui.printStatus("未识别到语音");
  } else {
    ui.printError(result.message);
  }
}

let trigger: Trigger | null = null;
let shuttingDown = false;

process.on("SIGINT", async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  trigger?.stop();
  try {
    // dispose() 发 quit 并等待 worker 退出（超时 kill 兜底），保证不残留孤儿 python.exe。
    await stt.dispose();
  } finally {
    process.exit(0);
  }
});

async function main() {
  ui.printStatus("正在加载语音模型…");
  try {
    // worker 加载完 ~2.9GB 模型并回 ready 后才允许说话，避免 F9 在预热期丢语音。
    await stt.waitReady(30000);
  } catch (err) {
    if (shuttingDown) return; // 用户在加载中按了 Ctrl+C，SIGINT 处理器负责退出
    ui.printError(`语音模型初始化失败：${err instanceof Error ? err.message : String(err)}`);
    await stt.dispose().catch(() => {});
    process.exit(1);
  }
  trigger = createTrigger(config.trigger);
  trigger.start({
    onStartListening: () => { stt.start(); ui.printStatus("🎙 录音中…（松开结束 / Esc 取消）"); },
    onStopListening: () => { void handleStop(); },
    onCancel: () => { stt.cancel(); ui.clearStatusLine(); ui.printStatus("已取消"); },
  });
  ui.printStatus(`就绪，按 ${config.trigger.key} 说话（Ctrl+C 退出）`);
}

void main();
