import type { Config } from "../config.js";
import { WorkerSttClient, type WorkerSttClientOptions } from "./workerClient.js";
import type { SttClient } from "./types.js";

export * from "./types.js";

export function createSttClient(stt: Config["stt"], cwd: string, options?: WorkerSttClientOptions): SttClient {
  return WorkerSttClient.spawnFor(stt, cwd, options);
}
