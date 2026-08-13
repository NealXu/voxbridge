import { loadConfig } from "./config.js";
import { createSttClient } from "./stt/index.js";
import { createAgentSession } from "./session/agentSession.js";
import { createTrigger } from "./trigger/index.js";
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
    ui.printStatus("就绪，按 F9 说话");
  } else if (result.kind === "noise") {
    ui.printStatus("未识别到语音");
  } else {
    ui.printError(result.message);
  }
}

const trigger = createTrigger(config.trigger);
trigger.start({
  onStartListening: () => { stt.start(); ui.printStatus("🎙 录音中…（松开结束 / Esc 取消）"); },
  onStopListening: () => { void handleStop(); },
  onCancel: () => { stt.cancel(); ui.clearStatusLine(); ui.printStatus("已取消"); },
});

process.on("SIGINT", async () => {
  trigger.stop();
  await stt.quit();
  // stt.quit() 只发送退出命令、不等待子进程退出；WorkerSttClient 无 kill()。
  // 稍候片刻让 Python worker 自行退出，避免残留 python.exe。
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
});
ui.printStatus(`就绪，按 ${config.trigger.key} 说话（Ctrl+C 退出）`);
