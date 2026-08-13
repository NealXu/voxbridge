import type { Config } from "../config.js";

export interface TriggerCallbacks {
  onStartListening(): void;
  onStopListening(): void;
  onCancel(): void;
}
export interface Trigger { start(cb: TriggerCallbacks): void; stop(): void; }
export declare function createTrigger(trigger: Config["trigger"]): Trigger;
