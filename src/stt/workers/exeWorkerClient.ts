import { WorkerSttClient, type WorkerSttClientOptions } from "../workerClient.js";
import { spawn } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { existsSync } from "node:fs";
import type { Config } from "../../config.js";
import { encodeCommand } from "../protocol.js";

/**
 * ExeWorkerClient - 通过 stdio JSONL 与 asr.exe worker 通信
 * 继承自 WorkerSttClient，复用所有通信逻辑
 */
export class ExeWorkerClient extends WorkerSttClient {
  /** exe 文件路径 */
  readonly exePath: string;

  constructor(
    stdout: NodeJS.ReadableStream,
    send: (cmd: import("../types.js").SttCommand) => void,
    child: import("node:child_process").ChildProcess | null | undefined,
    options?: WorkerSttClientOptions & { exePath?: string }
  ) {
    super(stdout as any, send, child ?? undefined, options);
    this.exePath = options?.exePath ?? "voxbridge-asr.exe";
  }

  /**
   * 为指定配置创建 exe worker 进程
   */
  static spawnFor(
    stt: Config["stt"],
    cwd: string,
    options?: WorkerSttClientOptions
  ): ExeWorkerClient {
    const exePath = resolveExePath(stt.workerPath ?? stt.worker_path, cwd);
    const args = buildExeArgs(stt);

    const child = spawn(exePath, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return new ExeWorkerClient(
      child.stdout!,
      (cmd) => child.stdin!.write(encodeCommand(cmd)),
      child,
      { ...options, exePath }
    );
  }
}

/**
 * 解析 exe 路径：绝对路径直接使用，相对路径基于 cwd
 */
function resolveExePath(workerPath: string | undefined, cwd: string): string {
  if (!workerPath) {
    // 默认路径查找
    const defaultPaths = [
      "dist/voxbridge-asr.exe",
      "voxbridge-asr.exe",
    ];
    for (const p of defaultPaths) {
      const full = join(cwd, p);
      if (existsSync(full)) return full;
    }
    return "voxbridge-asr.exe"; // fallback to PATH
  }
  return isAbsolute(workerPath) ? workerPath : join(cwd, workerPath);
}

/**
 * 构建 exe 命令行参数
 */
function buildExeArgs(stt: Config["stt"]): string[] {
  const args: string[] = [];

  if (stt.engine) args.push("--engine", stt.engine);
  if (stt.model) args.push("--model", stt.model);
  if (stt.model_dir) args.push("--model-dir", stt.model_dir);
  if (stt.language) args.push("--language", stt.language);

  // VAD 参数
  const vad = stt.vad;
  if (vad) {
    if (vad.threshold !== undefined) args.push("--vad-threshold", String(vad.threshold));
    if (vad.minVoiceMs !== undefined) args.push("--vad-min-voice-ms", String(vad.minVoiceMs));
    if (vad.silenceRms !== undefined) args.push("--vad-silence-rms", String(vad.silenceRms));
    if (vad.noiseMaxRms !== undefined) args.push("--vad-noise-max-rms", String(vad.noiseMaxRms));
    if (vad.chunkMs !== undefined) args.push("--vad-chunk-ms", String(vad.chunkMs));
    if (vad.endpointSilenceMs !== undefined) args.push("--vad-endpoint-silence-ms", String(vad.endpointSilenceMs));
  }

  if (stt.wakeWord) args.push("--wake-word", stt.wakeWord);

  return args;
}