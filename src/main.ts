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
import { createLoggerFromConfig } from "./logger/factory.js";
import type { Logger } from "./logger/index.js";

/** ANSI 颜色常量（用于状态显示） */
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

const config = loadConfig(process.argv[2] ?? "./config.json");
const rootLogger: Logger = createLoggerFromConfig(config);
const log = rootLogger.child("main");
const SESSION_FILE = join(homedir(), ".voxcode-session.json");
let ui: UI;

/** 提示词历史记录（最近 N 条） */
const promptHistory: string[] = [];
const MAX_PROMPT_HISTORY = 5;

/** 保留最近 N 行 worker stderr，崩溃时作为诊断上下文。 */
const recentStderrLines: string[] = [];
const MAX_RECENT_STDERR = 20;
function pushStderrLine(line: string): void {
  recentStderrLines.push(line);
  if (recentStderrLines.length > MAX_RECENT_STDERR) {
    recentStderrLines.shift();
  }
  // 同时写入结构化日志（warn 级，便于排查非致命错误）
  rootLogger.warn("worker.stderr", { line });
}

let stt = createSttClient(config.stt, process.cwd(), {
  onExit: handleWorkerExit,
  onDownloading: (p, m) => ui.printDownloadProgress(p, m),
  onStderrLine: pushStderrLine,
  logger: rootLogger,
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
  logger: rootLogger,
  callbacks: {
    onTextDelta: (t) => ui.printAssistantDelta(t),
    onToolStart: (name) => ui.printToolCall({ name }),
    onStatus: (s) => { if (s === "error") ui.printError("agent 调用失败"); },
    onDangerousTool: (name) => ui.printWarning(`[危险操作] ${name} — 正在执行…`),
    onToolResult: (tool: string, result: string) => ui.printToolResult(tool, result),
    onFileChange: (file: string, action: "create" | "modify" | "delete") => ui.printFileChange(file, action),
    onCommand: (cmd: string, output?: string) => ui.printCommand(cmd, output),
    onSessionFallback: (previousSessionId: string) => {
      log.warn("session resume failed, fell back to new session", { previousSessionId });
      ui.printWarning(`会话续接失败（ID=${previousSessionId.slice(0, 8)}…），已开启新会话`);
    },
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
/** 指数回退上限（ms）。 */
const MAX_BACKOFF_MS = 30_000;
/** 指数回退基础（ms）：第 N 次崩溃等待 base * 2^(N-1)。 */
const BASE_BACKOFF_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref();
  });
}

async function handleWorkerExit(_reason: string) {
  consecutiveCrashes++;
  const lastStderr = recentStderrLines.slice(-5);
  log.error("worker crashed", {
    consecutiveCrashes,
    maxCrashes: 3,
    lastStderr,
  });
  if (consecutiveCrashes >= 3) {
    log.fatal("worker crash limit reached, exiting", { lastStderr });
    ui.printError("Worker 连续 3 次崩溃，退出");
    process.exit(1);
  }
  // 指数回退：1s → 2s → 4s → … → 30s
  const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveCrashes - 1), MAX_BACKOFF_MS);
  ui.printStatus(`Worker 崩溃，${backoffMs / 1000}s 后重启…（第 ${consecutiveCrashes} 次）`);
  await sleep(backoffMs);
  // 清理旧 client（可能残留子进程），再建新连接。
  try {
    await stt.dispose();
  } catch {
    // dispose 在崩溃场景下可能抛（子进程已死），忽略
  }
  stt = createSttClient(config.stt, process.cwd(), {
    onExit: handleWorkerExit,
    onDownloading: (p, m) => ui.printDownloadProgress(p, m),
    onStderrLine: pushStderrLine,
    logger: rootLogger,
  });
  try {
    await stt.waitReady(60000);
    ui.printStatus(`就绪，按 ${config.trigger.key} 说话（Ctrl+C 退出）`);
    consecutiveCrashes = 0;
    recentStderrLines.length = 0; // 重启成功清空 stderr 历史
  } catch {
    // 新 worker 也崩溃了，onExit 会再次触发，继续计数 + 回退
  }
}

async function handleStop() {
  ui.clearStatusLine();
  ui.printStatus("语音输入成功，识别中…");
  const result = await stt.stop();
  if (result.kind === "text") {
    const finalText = await ui.promptEditRecognition(result.text);
    if (finalText === null) {
      // 取消编辑：显示"已取消"后短暂停留，再显示就绪提示
      await showCancelledThenReady();
      return;
    }
    // 编辑已确认，promptEditRecognition 已显示最终文本
    // 添加到历史
    addPromptToHistory(finalText);
    const r = await session.send(finalText);
    if (!r.ok) ui.printError(r.error);
    // Agent 执行完成后显示历史和就绪提示
    showPromptHistory();
    ui.printStatus(`就绪，按 ${config.trigger.key} 说话（Ctrl+C 退出）`);
  } else if (result.kind === "noise") {
    ui.printStatus("未识别到语音");
  } else {
    ui.printError(result.message);
  }
}

/** 显示"已取消"后短暂停留，再显示就绪提示（覆盖） */
async function showCancelledThenReady(): Promise<void> {
  // 在状态行显示"已取消"（会被后续状态覆盖）
  process.stdout.write(`\r\x1b[K${DIM}已取消${RESET}`);
  await sleep(500);
  // 覆盖显示就绪提示（同一行）
  ui.printStatus(`就绪，按 ${config.trigger.key} 说话（Ctrl+C 退出）`);
}

/** 显示提示词历史（最近 N 条） */
function showPromptHistory(): void {
  if (promptHistory.length === 0) return;
  // 只显示最近 5 条，从旧到新排列
  const toShow = promptHistory.slice(-MAX_PROMPT_HISTORY);
  for (const prompt of toShow) {
    // 显示用户输入的提示词（灰色，表示历史）
    process.stdout.write(`${DIM}🎤 ${prompt}${RESET}\n`);
  }
}

/** 添加提示词到历史并显示 */
function addPromptToHistory(prompt: string): void {
  promptHistory.push(prompt);
  // 保持最多 N 条历史
  while (promptHistory.length > MAX_PROMPT_HISTORY) {
    promptHistory.shift();
  }
}

let trigger: Trigger | null = null;
let shuttingDown = false;

process.on("SIGINT", async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("SIGINT received, shutting down");
  trigger?.stop();
  try {
    await stt.dispose();
    await rootLogger.flush();
    await rootLogger.close();
  } finally {
    process.exit(0);
  }
});

async function main() {
  ui = await createUI(config.ui?.mode ?? "console");
  log.info("voxcode starting", {
    uiMode: config.ui?.mode,
    triggerKey: config.trigger.key,
    wakeWord: config.trigger.wakeWord?.enabled ?? false,
    sttPlugin: config.stt.plugin,
  });
  ui.printStatus("正在初始化语音引擎（首次启动可能需下载模型）…");
  try {
    await stt.waitReady(60000);
  } catch (err) {
    if (shuttingDown) return;
    ui.printError(`语音模型初始化失败：${err instanceof Error ? err.message : String(err)}`);
    await stt.dispose().catch(() => {});
    process.exit(1);
  }
  trigger = createTrigger(config.trigger, stt as any, rootLogger);
  trigger.start({
    onStartListening: () => {
      log.info("onStartListening called", { recording });
      if (recording) return;
      recording = true;
      stt.start();
      ui.printStatus("🎙 录音中…（松开结束 / Esc 取消）");
      log.info("recording started");
    },
    onStopListening: () => {
      log.info("onStopListening called", { recording });
      if (!recording) return;
      recording = false;
      void handleStop();
    },
    onCancel: () => {
      log.info("onCancel called", { recording });
      recording = false;
      stt.cancel();
      ui.clearStatusLine();
      void showCancelledThenReady();
    },
  });
  ui.printStatus(`就绪，按 ${config.trigger.key} 说话（Ctrl+C 退出）`);
}

void main();
