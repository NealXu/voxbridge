import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { isAbsolute, join } from "node:path";
import { encodeCommand, parseEvent } from "./protocol.js";
import type { SttClient, SttCommand, SttEvent, SttResult } from "./types.js";
import type { Config } from "../config.js";
import type { Logger } from "../logger/index.js";

const WORKER_EXITED_MSG = "STT worker 意外退出";

/** WorkerSttClient 构造选项。 */
export interface WorkerSttClientOptions {
  /** worker 意外退出（非 dispose）时的回调。 */
  onExit?: (reason: string) => void;
  /** worker 报告模型下载进度。 */
  onDownloading?: (progress: number, message: string) => void;
  /** worker stderr 单行输出（用于崩溃诊断）。 */
  onStderrLine?: (line: string) => void;
  /** 结构化 logger。 */
  logger?: Logger;
}

/** 通过 stdio JSONL 与 Python worker 通信。构造可注入 stdio 便于测试。 */
export class WorkerSttClient implements SttClient {
  private reader: AsyncIterableIterator<string>;
  private pending: { resolve: (r: SttResult) => void; reject: (e: Error) => void } | null = null;
  private child: ChildProcess | null = null;
  /** worker 是否已退出（崩溃或 dispose）。 */
  exited = false;
  private ready = false;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private onExitCallback?: (reason: string) => void;
  private onDownloadingCallback?: (progress: number, message: string) => void;
  private onStderrLineCallback?: (line: string) => void;
  private intentionalExit = false;
  private log?: Logger;

  constructor(
    private stdout: Readable,
    private send: (cmd: SttCommand) => void,
    child?: ChildProcess,
    options?: WorkerSttClientOptions,
  ) {
    this.child = child ?? null;
    this.onExitCallback = options?.onExit;
    this.onDownloadingCallback = options?.onDownloading;
    this.onStderrLineCallback = options?.onStderrLine;
    this.log = options?.logger?.child("worker");
    this.reader = createInterface({ input: stdout as any, crlfDelay: Infinity })[Symbol.asyncIterator]();
    // worker 退出（崩溃 / OOM / quit）时 stdout 会 end：无论何种路径都要兜住挂起的
    // stop()/waitReady()，避免上层永久挂起。
    stdout.on("end", () => this.handleWorkerExit());
    child?.on("exit", (code, signal) => {
      this.log?.info("worker exit event", { pid: child.pid, code, signal });
      this.handleWorkerExit();
    });
    if (child) {
      this.log?.info("worker spawned", { pid: child.pid });
    }
    void this.pump();
  }

  /** 逐行读取 stdout，解析并分发事件。任何失败都不能成为未处理的 rejection。 */
  private async pump(): Promise<void> {
    try {
      for await (const line of this.reader) {
        if (!line.trim()) continue;
        let ev: SttEvent;
        try {
          ev = parseEvent(line);
        } catch (err) {
          // 单条畸形行只结算当前 stop()，不 crash 整个 app，继续读后续行。
          this.settlePending({ kind: "error", message: err instanceof Error ? err.message : "STT 协议解析失败" });
          continue;
        }
        this.dispatch(ev);
      }
    } catch {
      // 流读取异常（worker 崩溃等）走统一退出兜底。
    }
    this.handleWorkerExit();
  }

  private dispatch(ev: SttEvent): void {
    if (ev.type === "ready") {
      this.ready = true;
      this.log?.info("worker ready");
      if (this.readyResolve) {
        const resolve = this.readyResolve;
        this.readyResolve = null;
        this.readyReject = null;
        resolve();
      }
      return;
    }
    if (ev.type === "error") {
      this.log?.error("worker reported error", { message: ev.message });
      // 等待 ready 期间的 error 也要让 waitReady() 拒绝。
      this.rejectReady(new Error(ev.message));
      this.settlePending({ kind: "error", message: ev.message });
      return;
    }
    if (ev.type === "result" || ev.type === "noise") {
      this.log?.debug("worker event", { type: ev.type, text: ev.type === "result" ? ev.text : undefined });
      this.settlePending(ev.type === "result" ? { kind: "text", text: ev.text } : { kind: "noise" });
    }
    if (ev.type === "downloading" && this.onDownloadingCallback) {
      this.onDownloadingCallback(ev.progress, ev.message);
    }
  }

  /** 结算当前挂起的 stop()；无挂起则忽略。 */
  private settlePending(result: SttResult): void {
    const p = this.pending;
    this.pending = null;
    if (p) p.resolve(result);
  }

  private rejectReady(err: Error): void {
    if (this.readyResolve) {
      const reject = this.readyReject;
      this.readyResolve = null;
      this.readyReject = null;
      reject?.(err);
    }
  }

  /** worker 退出兜底：结算挂起的 stop() 与 waitReady()，保证上层永不挂起。 */
  private handleWorkerExit(): void {
    if (this.exited) return;
    this.exited = true;
    const code = this.child?.exitCode;
    const signal = this.child?.signalCode;
    this.log?.warn("worker exit", { pid: this.child?.pid, code, signal, intentional: this.intentionalExit });
    this.rejectReady(new Error(WORKER_EXITED_MSG));
    this.settlePending({ kind: "error", message: WORKER_EXITED_MSG });
    // 非故意退出（崩溃）时触发 onExit 回调
    if (!this.intentionalExit && this.onExitCallback) {
      this.onExitCallback(WORKER_EXITED_MSG);
    }
  }

  static spawnFor(stt: Config["stt"], cwd: string, options?: WorkerSttClientOptions): WorkerSttClient {
    const pythonPath = resolvePython(stt.python_path, cwd);
    const args = [
      "stt_worker/main.py", "--model", stt.model, "--model-dir", stt.model_dir, "--language", stt.language,
    ];
    // VAD 参数（可选）— 透传给 Python worker，允许运行时调优
    const vad = stt.vad;
    if (vad) {
      if (vad.threshold !== undefined) args.push("--vad-threshold", String(vad.threshold));
      if (vad.minVoiceMs !== undefined) args.push("--vad-min-voice-ms", String(vad.minVoiceMs));
      if (vad.silenceRms !== undefined) args.push("--vad-silence-rms", String(vad.silenceRms));
      if (vad.noiseMaxRms !== undefined) args.push("--vad-noise-max-rms", String(vad.noiseMaxRms));
      if (vad.chunkMs !== undefined) args.push("--vad-chunk-ms", String(vad.chunkMs));
      if (vad.endpointSilenceMs !== undefined) args.push("--vad-endpoint-silence-ms", String(vad.endpointSilenceMs));
    }
    options?.logger?.info("spawning worker", { pythonPath, args: args.join(" "), cwd });
    const child = spawn(pythonPath, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    // stderr 按行分发给上层（用于崩溃诊断）。不阻断业务流 — 回调失败仅 warn 到日志。
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr, crlfDelay: Infinity });
      rl.on("line", (line) => {
        try {
          options?.onStderrLine?.(line);
        } catch (err) {
          options?.logger?.warn("onStderrLine callback failed", { error: (err as Error).message });
        }
      });
      // unref：stderr 读取不应阻止进程退出
      rl.on("close", () => {});
    }
    return new WorkerSttClient(child.stdout!, (cmd) => child.stdin!.write(encodeCommand(cmd)), child, options);
  }

  start(): void { this.safeSend({ type: "start" }); }
  stop(): Promise<SttResult> {
    if (!this.safeSend({ type: "stop" })) {
      return Promise.resolve({ kind: "error", message: WORKER_EXITED_MSG });
    }
    return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
  }
  cancel(): void { this.pending = null; }
  quit(): Promise<void> {
    this.safeSend({ type: "quit" });
    return Promise.resolve();
  }

  waitReady(timeoutMs = 30000): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.exited) return Promise.reject(new Error(WORKER_EXITED_MSG));
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      // unref：超时定时器不应阻止进程退出。
      setTimeout(() => this.rejectReady(new Error("STT worker 就绪超时")), timeoutMs).unref();
    });
  }

  /** 完整关闭：发 quit → 等子进程退出（1s 宽限）→ 超时 kill 兜底并等退出。 */
  async dispose(): Promise<void> {
    const child = this.child;
    // 标记为故意退出，避免触发 onExit 回调
    this.intentionalExit = true;
    if (!child) {
      // 测试注入构造：无真实子进程，仅发 quit 并兜住挂起状态。
      this.quit();
      this.handleWorkerExit();
      return;
    }
    if (this.exited || child.exitCode !== null || child.signalCode !== null) return;
    this.quit();
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
    });
    await Promise.race([exited, new Promise((r) => setTimeout(r, 1000))]);
    if (child.exitCode === null && child.signalCode === null) {
      // 宽限已过仍存活：强制终止并等待退出，避免残留 python.exe。
      child.kill();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", () => resolve());
      });
    }
  }

  private safeSend(cmd: SttCommand): boolean {
    if (this.exited) return false;
    try {
      this.send(cmd);
      return true;
    } catch {
      return false;
    }
  }
}

function resolvePython(pythonPath: string, cwd: string): string {
  return isAbsolute(pythonPath) ? pythonPath : join(cwd, pythonPath);
}
