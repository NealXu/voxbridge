import { GlobalKeyboardListener } from "node-global-key-listener";
import { feedTerminalInput } from "./terminalKeys.js";
import type { Trigger, TriggerCallbacks } from "./types.js";
import type { Config } from "../config.js";
import { createWakeWordTrigger, type WakeWordSttClient } from "./wakeword.js";
import { appendFileSync } from "fs";
import { join } from "path";

const LOG_FILE = join(process.cwd(), "voxcode-debug.log");
function log(msg: string) {
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

export * from "./types.js";

/** 全局热键 hold-to-talk：按下 F9 开始，松开结束。依赖 node-global-key-listener 原生模块。 */
export function createGlobalTrigger(key: string): Trigger {
  let cb: TriggerCallbacks | null = null;
  let listener: GlobalKeyboardListener | null = null;
  let listening = false;

  const onStdinData = (chunk: Buffer) => {
    if (chunk.includes(0x1b)) {
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
      void listener.addListener((e) => {
        if (e.name !== key) return;
        if (e.state === "DOWN") {
          listening = true;
          cb!.onStartListening();
          setupStdin();
        } else {
          if (listening) {
            listening = false;
            cleanupStdin();
            cb!.onStopListening();
          }
        }
      }).catch((err) => {
        console.error("[trigger] global hotkey failed to start:", err);
      });
    },
    stop() {
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
export function createTerminalTrigger(): Trigger {
  let cb: TriggerCallbacks | null = null;
  let listening = false;
  let lastToggleTime = 0;
  const DEBOUNCE_MS = 300; // 防止快速连续触发

  const onData = (chunk: Buffer) => {
    log(`stdin data: ${chunk.toString("hex")} (${chunk.length} bytes)`);
    // Handle Ctrl+C (0x03) for graceful exit
    if (chunk.includes(0x03)) {
      log(`Ctrl+C detected, exiting...`);
      process.emit("SIGINT");
      return;
    }

    const now = Date.now();
    for (const action of feedTerminalInput(chunk.toString())) {
      log(`action: ${action.kind}`);
      if (action.kind === "toggle") {
        // 防抖：忽略 300ms 内的重复触发
        if (now - lastToggleTime < DEBOUNCE_MS) {
          log(`toggle ignored (debounce: ${now - lastToggleTime}ms < ${DEBOUNCE_MS}ms)`);
          continue;
        }
        lastToggleTime = now;

        listening = !listening;
        listening ? cb!.onStartListening() : cb!.onStopListening();
      } else {
        cb!.onCancel();
      }
    }
  };
  return {
    start(c: TriggerCallbacks) {
      cb = c;
      log(`terminal trigger starting, isTTY=${process.stdin.isTTY}`);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.on("data", onData);
      log(`stdin listener attached`);
    },
    stop() {
      log(`terminal trigger stopping`);
      process.stdin.off("data", onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      cb = null;
      listening = false;
    },
  };
}

export function createTrigger(trigger: Config["trigger"], sttClient?: WakeWordSttClient): Trigger {
  if (trigger.wakeWord?.enabled) {
    if (!sttClient) {
      throw new Error("唤醒词模式需要 STT client 支持 wake 事件");
    }
    return createWakeWordTrigger(sttClient);
  }
  return trigger.global ? createGlobalTrigger(trigger.key) : createTerminalTrigger();
}
