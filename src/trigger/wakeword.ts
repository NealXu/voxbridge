/**唤醒词触发器：监听 worker 的 wake 事件，无需按键即开始录音。 */
import type { Trigger, TriggerCallbacks } from "./types.js";

export interface WakeWordSttClient {
  /** 注册唤醒词事件监听器。 */
  onWake(callback: () => void): void;
  /** 移除唤醒词事件监听器。 */
  offWake(callback: () => void): void;
}

/**
 * 创建唤醒词触发器。
 *
 * @param sttClient - STT client，需支持 onWake/offWake
 * @returns Trigger 实例
 */
export function createWakeWordTrigger(sttClient: WakeWordSttClient): Trigger {
  let cb: TriggerCallbacks | null = null;
  let wakeHandler: (() => void) | null = null;

  return {
    start(callbacks: TriggerCallbacks) {
      cb = callbacks;
      wakeHandler = () => {
        cb?.onStartListening();
      };
      sttClient.onWake(wakeHandler);
    },

    stop() {
      if (wakeHandler) {
        sttClient.offWake(wakeHandler);
        wakeHandler = null;
      }
      cb = null;
    },
  };
}