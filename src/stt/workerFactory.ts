import type { Config } from "../config.js";
import { WorkerSttClient, type WorkerSttClientOptions } from "./workerClient.js";
import { ExeWorkerClient } from "./workers/exeWorkerClient.js";
import { PluginSttClientAdapter } from "./pluginAdapter.js";
import { createPlugin } from "./pluginRegistry.js";
import type { SttClient } from "./types.js";
import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";

/** Worker 类型 */
export type WorkerType = "auto" | "python" | "exe" | "cloud" | "native";

/**
 * 解析 worker 类型
 * 优先级：显式指定 > plugin 字段 > workerPath 扩展名 > cloud 配置 > 默认
 */
export function resolveWorkerType(stt: Config["stt"]): WorkerType {
  // 显式指定
  if (stt.workerType && stt.workerType !== "auto") {
    return stt.workerType;
  }

  // plugin 字段 → native
  if (stt.plugin === "webspeech") {
    return "native";
  }

  // workerPath 指向 exe → exe
  const workerPath = stt.workerPath ?? stt.worker_path;
  if (workerPath?.endsWith(".exe")) {
    return "exe";
  }

  // 云 API 配置 → cloud
  if (stt.cloud?.provider && stt.cloud?.apiKey) {
    return "cloud";
  }

  // 默认: python
  return "python";
}

/**
 * 创建 STT 客户端
 * 根据 workerType 自动路由到对应的实现
 */
export async function createSttClient(
  stt: Config["stt"],
  cwd: string,
  options?: WorkerSttClientOptions
): Promise<SttClient> {
  const workerType = resolveWorkerType(stt);

  switch (workerType) {
    case "exe":
      return ExeWorkerClient.spawnFor(stt, cwd, options);

    case "python":
      return WorkerSttClient.spawnFor(stt, cwd, options);

    case "native":
      const plugin = await createPlugin(stt.plugin ?? "webspeech", stt);
      return new PluginSttClientAdapter(plugin);

    case "cloud":
      throw new Error("Cloud worker not implemented yet");

    case "auto":
    default:
      // 自动选择: 优先 exe (如果存在), 否则 python
      const workerPath = stt.workerPath ?? stt.worker_path;
      if (workerPath) {
        const exePath = isAbsolute(workerPath) ? workerPath : join(cwd, workerPath);
        if (existsSync(exePath)) {
          return ExeWorkerClient.spawnFor(stt, cwd, options);
        }
      }
      return WorkerSttClient.spawnFor(stt, cwd, options);
  }
}