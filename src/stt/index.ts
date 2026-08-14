import type { Config } from "../config.js";
import { WorkerSttClient, type WorkerSttClientOptions } from "./workerClient.js";
import { PluginSttClientAdapter } from "./pluginAdapter.js";
import { WebSpeechPlugin } from "./plugins/webSpeechPlugin.js";
import type { SttClient } from "./types.js";

export * from "./types.js";

export function createSttClient(
  stt: Config["stt"],
  cwd: string,
  options?: WorkerSttClientOptions,
): SttClient {
  const plugin = stt.plugin ?? "whisper";

  if (plugin === "webspeech") {
    const wsConfig = {
      language: stt.language ?? "zh-CN",
      ...stt.webspeech,
    };
    const wsPlugin = new WebSpeechPlugin(wsConfig);
    return new PluginSttClientAdapter(wsPlugin);
  }

  // 默认: whisper
  return WorkerSttClient.spawnFor(stt, cwd, options);
}
