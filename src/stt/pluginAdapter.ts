import type { SttPlugin } from "./pluginTypes.js";
import type { SttClient, SttResult } from "./types.js";

/**
 * 将 SttPlugin 适配为 SttClient 接口
 * main.ts 只与 SttClient 交互，此适配器屏蔽插件差异
 */
export class PluginSttClientAdapter implements SttClient {
  private plugin: SttPlugin;
  private ready = false;
  private pendingStop: Promise<SttResult> | null = null;

  constructor(plugin: SttPlugin) {
    this.plugin = plugin;
  }

  async waitReady(timeoutMs?: number): Promise<void> {
    if (this.ready) return;
    const timeout = timeoutMs ?? 60000;
    await Promise.race([
      this.plugin.start().then(() => { this.ready = true; }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("STT plugin 启动超时")), timeout).unref()
      ),
    ]);
  }

  start(): void {
    if (!this.ready) return;
    this.plugin.startRecording();
  }

  stop(): Promise<SttResult> {
    if (!this.ready) {
      return Promise.resolve({ kind: "error", message: "STT plugin not ready" });
    }
    this.pendingStop = this.plugin.stopRecording();
    return this.pendingStop;
  }

  cancel(): void {
    this.pendingStop = null;
  }

  async quit(): Promise<void> {
    // 插件无 quit 协议，空操作
  }

  async dispose(): Promise<void> {
    await this.plugin.dispose();
    this.ready = false;
  }
}
