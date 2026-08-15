import { loadConfig } from "./config.js";
import { createSttClient } from "./stt/index.js";
import type { SttClient } from "./stt/index.js";
import { createAgentSession } from "./session/agentSession.js";
import { createClaudeExecutor, ClaudeExecutor, CostTracker } from "./executor/index.js";
import { createTrigger } from "./trigger/index.js";
import type { Trigger } from "./trigger/index.js";
import { createUI } from "./ui/index.js";
import type { UI, ToolCallInfo } from "./ui/index.js";
import type { CompletionStats } from "./executor/index.js";
import { homedir } from "os";
import { join } from "path";
import { appendFileSync } from "fs";

const LOG_FILE = join(process.cwd(), "voxcode-debug.log");
function log(msg: string) {
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

const config = loadConfig(process.argv[2] ?? "./config.json");
const SESSION_FILE = join(homedir(), ".voxcode-session.json");
let ui: UI;
let stt = createSttClient(config.stt, process.cwd(), {
  onExit: handleWorkerExit,
  onDownloading: (p, m) => ui.printDownloadProgress(p, m),
});
const costTracker = new CostTracker();

// CC Executor: 通过 SDK 启动并控制本地 Claude Code 实例。
const executor: ClaudeExecutor = createClaudeExecutor({
  logger: console,
  claudePath: config.claude?.path,
  settingsPath: config.claude?.settingsPath,
  model: config.claude?.model,
});
const session = createAgentSession({
  config,
  cwd: process.cwd(),
  sessionFile: SESSION_FILE,
  executor,
  callbacks: {
    onTextDelta: (t) => ui.printAssistantDelta(t),
    onToolStart: (name) => ui.printToolCall({ name }),
    onStatus: (s) => { if (s === "error") ui.printError("agent 调用失败"); },
    onDangerousTool: (name) => ui.printWarning(`[危险操作] ${name} — 正在执行…`),
    onToolResult: (tool: string, result: string) => ui.printToolResult(tool, result),
    onFileChange: (file: string, action: "create" | "modify" | "delete") => ui.printFileChange(file, action),
    onCommand: (cmd: string, output?: string) => ui.printCommand(cmd, output),
    onCompletion: (stats: CompletionStats) => {
      costTracker.add({
        total_cost_usd: stats.costUsd,
        duration_ms: stats.durationMs,
      });
      ui.printCompletion(costTracker.getStats());
    },
  },
});

// 崩溃恢复相关状态
let consecutiveCrashes = 0;
let recording = false;

function handleWorkerExit(_reason: string) {
  consecutiveCrashes++;
  if (consecutiveCrashes >= 3) {
    ui.printError("Worker 连续 3 次崩溃，退出");
    process.exit(1);
  }
  ui.printStatus("Worker 崩溃，正在重启…");
  stt = createSttClient(config.stt, process.cwd(), {
    onExit: handleWorkerExit,
    onDownloading: (p, m) => ui.printDownloadProgress(p, m),
  });
  stt.waitReady(60000)
    .then(() => {
      ui.printStatus(`就绪，按 ${config.trigger.key} 说话（Ctrl+C 退出）`);
      consecutiveCrashes = 0;
    })
    .catch(() => {
      // 新 worker 也崩溃了，onExit 会再次触发，继续计数
    });
}

async function handleStop() {
  ui.clearStatusLine();
  const result = await stt.stop();
  if (result.kind === "text") {
    const finalText = await ui.promptEditRecognition(result.text);
    if (finalText === null) {
      ui.printStatus("已取消");
      return;
    }
    const r = await session.send(finalText);
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
    await stt.dispose();
  } finally {
    process.exit(0);
  }
});

async function main() {
  ui = await createUI(config.ui?.mode ?? "console");
  ui.printStatus("正在初始化语音引擎（首次启动可能需下载模型）…");
  try {
    await stt.waitReady(60000);
  } catch (err) {
    if (shuttingDown) return;
    ui.printError(`语音模型初始化失败：${err instanceof Error ? err.message : String(err)}`);
    await stt.dispose().catch(() => {});
    process.exit(1);
  }
  trigger = createTrigger(config.trigger);
  trigger.start({
    onStartListening: () => {
      log(`onStartListening called, recording=${recording}`);
      if (recording) return;
      recording = true;
      stt.start();
      ui.printStatus("🎙 录音中…（松开结束 / Esc 取消）");
      log(`recording started, status printed`);
    },
    onStopListening: () => {
      log(`onStopListening called, recording=${recording}`);
      if (!recording) return;
      recording = false;
      void handleStop();
    },
    onCancel: () => {
      log(`onCancel called, recording=${recording}`);
      recording = false;
      stt.cancel();
      ui.clearStatusLine();
      ui.printStatus("已取消");
    },
  });
  ui.printStatus(`就绪，按 ${config.trigger.key} 说话（Ctrl+C 退出）`);
}

void main();
