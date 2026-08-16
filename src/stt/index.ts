import type { Config } from "../config.js";
import type { WorkerSttClientOptions } from "./workerClient.js";
import { WorkerSttClient } from "./workerClient.js";
import { ExeWorkerClient } from "./workers/exeWorkerClient.js";
import { PluginSttClientAdapter } from "./pluginAdapter.js";
import { WebSpeechPlugin } from "./plugins/webSpeechPlugin.js";
import type { SttClient } from "./types.js";
import { resolveWorkerType } from "./workerFactory.js";
import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";

export * from "./types.js";
export { resolveWorkerType, type WorkerType } from "./workerFactory.js";
export type { WorkerCommand, WorkerEvent, WorkerConfig, WorkerCapabilities } from "./workerProtocol.js";

/**
 * 创建 STT 客户端
 * 根据 workerType 自动路由到对应实现：
 * - "python": Python 脚本 worker (WorkerSttClient)
 * - "exe": asr.exe worker (ExeWorkerClient)
 * - "native": 进程内插件 (WebSpeech)
 * - "auto": 自动选择（默认）
 */
export function createSttClient(
  stt: Config["stt"],
  cwd: string,
  options?: WorkerSttClientOptions,
): SttClient {
  const workerType = resolveWorkerType(stt);

  switch (workerType) {
    case "exe":
      return ExeWorkerClient.spawnFor(stt, cwd, options);

    case "native":
      const wsConfig = {
        language: stt.language ?? "zh-CN",
        ...stt.webspeech,
      };
      return new PluginSttClientAdapter(new WebSpeechPlugin(wsConfig));

    case "python":
    case "auto":
    default:
      // auto 模式：如果 workerPath 指向存在的 exe，用 exe worker
      if (workerType === "auto") {
        const workerPath = stt.workerPath ?? stt.worker_path;
        if (workerPath) {
          const exePath = isAbsolute(workerPath) ? workerPath : join(cwd, workerPath);
          if (existsSync(exePath)) {
            return ExeWorkerClient.spawnFor(stt, cwd, options);
          }
        }
      }
      return WorkerSttClient.spawnFor(stt, cwd, options);
  }
}
