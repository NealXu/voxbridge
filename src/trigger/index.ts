import { GlobalKeyboardListener } from "node-global-key-listener";
import { feedTerminalInput } from "./terminalKeys.js";
import type { Trigger, TriggerCallbacks } from "./types.js";
import type { Config } from "../config.js";

export * from "./types.js";

/** 全局热键 hold-to-talk：任意应用按下 F9 开始，松开结束。依赖 node-global-key-listener 原生模块。 */
export function createGlobalTrigger(key: string): Trigger {
  let cb: TriggerCallbacks | null = null;
  let listener: GlobalKeyboardListener | null = null;
  return {
    start(c: TriggerCallbacks) {
      cb = c;
      listener = new GlobalKeyboardListener();
      void listener.addListener((e) => {
        if (e.name !== key) return;
        if (e.state === "DOWN") cb!.onStartListening();
        else cb!.onStopListening();
      }).catch((err) => {
        console.error("[trigger] global hotkey failed to start:", err);
      });
    },
    stop() { listener?.kill(); listener = null; cb = null; },
  };
}

/** 终端内 F9 切换：按下 F9 开始录音，再按结束；Esc 取消。无原生依赖，最可靠。 */
export function createTerminalTrigger(): Trigger {
  let cb: TriggerCallbacks | null = null;
  let listening = false;
  const onData = (chunk: Buffer) => {
    for (const action of feedTerminalInput(chunk.toString())) {
      if (action.kind === "toggle") {
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
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.on("data", onData);
    },
    stop() {
      process.stdin.off("data", onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      cb = null;
      listening = false;
    },
  };
}

export function createTrigger(trigger: Config["trigger"]): Trigger {
  return trigger.global ? createGlobalTrigger(trigger.key) : createTerminalTrigger();
}
