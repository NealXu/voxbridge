import { GlobalKeyboardListener } from "node-global-key-listener";
import { feedTerminalInput, setTerminalKeysLogger } from "./terminalKeys.js";
import type { Trigger, TriggerCallbacks } from "./types.js";
import type { Config } from "../config.js";
import { createWakeWordTrigger, type WakeWordSttClient } from "./wakeword.js";
import type { Logger } from "../logger/index.js";

export * from "./types.js";

/** 全局热键 hold-to-talk：按下 F9 开始，松开结束。依赖 node-global-key-listener 原生模块。 */
export function createGlobalTrigger(key: string, logger?: Logger): Trigger {
  const log = logger?.child("trigger.global");
  let cb: TriggerCallbacks | null = null;
  let listener: GlobalKeyboardListener | null = null;
  let listening = false;

  const onStdinData = (chunk: Buffer) => {
    // 诊断：记录每次 stdin 数据的字节数 + hex（前 16 字节），用于排查 F9 触发的 cancel 来源
    log?.debug("stdin data", {
      len: chunk.length,
      hex: chunk.subarray(0, 16).toString("hex"),
    });
    // 只把「单字节的孤立 ESC」视为取消。
    // 多字节 ESC 序列（F9 = ESC [ 2 0 ~ 或 ESC O Q，方向键等）一律忽略 —
    // 全局热键模式下 F9 由 OS 层监听，terminal 收到的 ESC 序列是副作用，不能当取消。
    if (chunk.length === 1 && chunk[0] === 0x1b) {
      log?.debug("escape detected, cancelling");
      listening = false;
      cleanupStdin();
      cb?.onCancel();
    }
  };

  const setupStdin = () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on("data", onStdinData);
  };

  const cleanupStdin = () => {
    process.stdin.off("data", onStdinData);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  };

  return {
    start(c: TriggerCallbacks) {
      cb = c;
      listener = new GlobalKeyboardListener();
      log?.info("global trigger starting", { key });
      void listener.addListener((e) => {
        if (e.name !== key) return;
        if (e.state === "DOWN") {
          log?.info("key DOWN", { key });
          listening = true;
          cb!.onStartListening();
          setupStdin();
        } else {
          if (listening) {
            log?.info("key UP", { key });
            listening = false;
            cleanupStdin();
            cb!.onStopListening();
          }
        }
      }).catch((err) => {
        log?.error("global hotkey failed to start", { error: err instanceof Error ? err.message : String(err) });
      });
    },
    stop() {
      log?.info("global trigger stopping");
      listener?.kill();
      listener = null;
      if (listening) {
        cleanupStdin();
        listening = false;
      }
      cb = null;
    },
  };
}

/** 终端内 F9 切换：按下 F9 开始录音，再按结束；Esc 取消。无原生依赖，最可靠。 */
export function createTerminalTrigger(logger?: Logger): Trigger {
  const log = logger?.child("trigger.terminal");
  let cb: TriggerCallbacks | null = null;
  let listening = false;
  let lastToggleTime = 0;
  const DEBOUNCE_MS = 300; // 防止快速连续触发

  const onData = (chunk: Buffer) => {
    log?.debug("stdin data", { chunkHex: chunk.toString("hex"), chunkLen: chunk.length });
    // Handle Ctrl+C (0x03) for graceful exit
    if (chunk.includes(0x03)) {
      log?.info("Ctrl+C detected");
      process.emit("SIGINT");
      return;
    }

    const now = Date.now();
    for (const action of feedTerminalInput(chunk.toString())) {
      log?.debug("action", { kind: action.kind });
      if (action.kind === "toggle") {
        // 防抖：忽略 300ms 内的重复触发
        const elapsed = now - lastToggleTime;
        if (elapsed < DEBOUNCE_MS) {
          log?.debug("toggle ignored (debounce)", { elapsedMs: elapsed, thresholdMs: DEBOUNCE_MS });
          continue;
        }
        lastToggleTime = now;

        listening = !listening;
        log?.info("toggle", { listening });
        listening ? cb!.onStartListening() : cb!.onStopListening();
      } else {
        cb!.onCancel();
      }
    }
  };
  return {
    start(c: TriggerCallbacks) {
      cb = c;
      log?.info("terminal trigger starting", { isTTY: process.stdin.isTTY });
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.on("data", onData);
    },
    stop() {
      log?.info("terminal trigger stopping");
      process.stdin.off("data", onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      cb = null;
      listening = false;
    },
  };
}

export function createTrigger(
  trigger: Config["trigger"],
  sttClient?: WakeWordSttClient,
  logger?: Logger,
): Trigger {
  if (logger) setTerminalKeysLogger(logger);
  if (trigger.wakeWord?.enabled) {
    if (!sttClient) {
      throw new Error("唤醒词模式需要 STT client 支持 wake 事件");
    }
    logger?.child("trigger").info("wake word trigger selected");
    return createWakeWordTrigger(sttClient);
  }
  logger?.child("trigger").info("key trigger selected", { global: trigger.global, key: trigger.key });
  return trigger.global ? createGlobalTrigger(trigger.key, logger) : createTerminalTrigger(logger);
}
