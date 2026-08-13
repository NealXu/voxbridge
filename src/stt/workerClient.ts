import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { isAbsolute, join } from "node:path";
import { encodeCommand, parseEvent } from "./protocol.js";
import type { SttClient, SttCommand, SttEvent, SttResult } from "./types.js";
import type { Config } from "../config.js";

/** 通过 stdio JSONL 与 Python worker 通信。构造可注入 stdio 便于测试。 */
export class WorkerSttClient implements SttClient {
  private reader: AsyncIterableIterator<string>;
  private pending: { resolve: (r: SttResult) => void; reject: (e: Error) => void } | null = null;

  constructor(
    private stdout: Readable,
    private send: (cmd: SttCommand) => void,
  ) {
    this.reader = createInterface({ input: stdout as any, crlfDelay: Infinity })[Symbol.asyncIterator]();
    this.pump();
  }

  private async pump(): Promise<void> {
    for await (const line of this.reader) {
      if (!line.trim()) continue;
      const ev = parseEvent(line);
      this.dispatch(ev);
    }
  }

  private dispatch(ev: SttEvent): void {
    if (ev.type === "result" || ev.type === "noise" || ev.type === "error") {
      const p = this.pending;
      this.pending = null;
      if (!p) return;
      if (ev.type === "result") p.resolve({ kind: "text", text: ev.text });
      else if (ev.type === "noise") p.resolve({ kind: "noise" });
      else p.resolve({ kind: "error", message: ev.message });
    }
  }

  static spawnFor(stt: Config["stt"], cwd: string): WorkerSttClient {
    const child = spawn(resolvePython(stt.python_path, cwd), [
      "stt_worker/main.py", "--model", stt.model, "--model-dir", stt.model_dir, "--language", stt.language,
    ], { cwd });
    return new WorkerSttClient(child.stdout!, (cmd) => child.stdin!.write(encodeCommand(cmd)));
  }

  start(): void { this.send({ type: "start" }); }
  stop(): Promise<SttResult> {
    this.send({ type: "stop" });
    return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
  }
  cancel(): void { this.pending = null; }
  async quit(): Promise<void> { this.send({ type: "quit" }); }
}

function resolvePython(pythonPath: string, cwd: string): string {
  return isAbsolute(pythonPath) ? pythonPath : join(cwd, pythonPath);
}
