import type { SttPlugin } from "./pluginTypes.js";
import type { Config } from "../config.js";

// 转发导入，避免循环依赖
import { WorkerSttClient } from "./workerClient.js";
import type { SttResult, SttClient } from "./types.js";
import { WebSpeechPlugin } from "./plugins/webSpeechPlugin.js";

/** Whisper 插件：包装现有 WorkerSttClient。 */
class WhisperPlugin implements SttPlugin {
  private client: SttClient | null = null;
  private pending: Promise<SttResult> | null = null;

  constructor(private config: Config["stt"], private cwd: string) {}

  async start(): Promise<void> {
    this.client = WorkerSttClient.spawnFor(this.config, this.cwd);
    await this.client.waitReady();
  }

  startRecording(): void {
    if (!this.client) throw new Error("Plugin not started");
    this.client.start();
  }

  stopRecording(): Promise<SttResult> {
    if (!this.client) return Promise.resolve({ kind: "error", message: "Plugin not started" });
    this.pending = this.client.stop();
    return this.pending;
  }

  async dispose(): Promise<void> {
    if (this.client) {
      await this.client.dispose();
      this.client = null;
    }
  }
}

/** 创建 STT 插件实例。 */
export function createPlugin(name: string, config: any): SttPlugin {
  switch (name) {
    case "whisper":
      // WhisperPlugin 需要 stt 配置和 cwd，这里提供默认值
      // 实际使用时应该传入完整的配置
      return new WhisperPlugin(config, process.cwd());
    case "webspeech":
      return new WebSpeechPlugin(config);
    default:
      throw new Error(`Unknown plugin: ${name}`);
  }
}

// 为了支持测试，导出一个工厂函数
export function createWhisperPlugin(config: Config["stt"], cwd: string): SttPlugin {
  return new WhisperPlugin(config, cwd);
}