import type { Config } from "../config.js";
import { WorkerSttClient } from "./workerClient.js";
import type { SttClient } from "./types.js";

export * from "./types.js";

export function createSttClient(stt: Config["stt"], cwd: string): SttClient {
  return WorkerSttClient.spawnFor(stt, cwd);
}
