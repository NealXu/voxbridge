/**
 * 异步文件 transport：按日期分文件 + 按大小轮转，非阻塞写入。
 *
 * 设计要点：
 * - 内存队列 + 单 writer 协程：log() 只入队，writer 异步批写，永不阻塞业务线程。
 * - 队列满时丢弃最旧记录（背压保护），避免 OOM。
 * - 文件名格式：`voxcode.YYYY-MM-DD.log`；跨天自动切新文件。
 * - 单文件超过 maxSize 时重命名为 `.N.log` 后缀再开新文件。
 * - 保留最近 maxFiles 份历史；超出的旧文件异步删除。
 * - flush() 等待队列清空；close() 关闭 writer 协程。
 *
 * @module logger/fileTransport
 */

import { appendFile, mkdir, rename, readdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { LogRecord, LogTransport } from "./index.js";
import { LEVEL_LABEL } from "./levels.js";

export interface FileTransportOptions {
  /** 日志目录，支持 `~` 前缀。默认 `~/.voxcode/logs`。 */
  dir?: string;
  /** 单文件最大字节数，默认 10MB。 */
  maxSize?: number;
  /** 保留的历史文件数，默认 5。 */
  maxFiles?: number;
  /** 队列容量上限，默认 10000 条。超过丢弃最旧。 */
  queueCapacity?: number;
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_QUEUE_CAPACITY = 10_000;

export class FileTransport implements LogTransport {
  private readonly dir: string;
  private readonly maxSize: number;
  private readonly maxFiles: number;
  private readonly queueCapacity: number;

  private queue: LogRecord[] = [];
  private writing = false;
  private flushResolve: (() => void) | null = null;
  private closed = false;
  private currentDate = "";
  private currentPath = "";
  private currentSize = 0;
  /** writer 协程的唤醒函数。 */
  private pump: (() => void) | null = null;

  constructor(opts: FileTransportOptions = {}) {
    this.dir = resolvePath(opts.dir ?? "~/.voxcode/logs");
    this.maxSize = opts.maxSize ?? DEFAULT_MAX_SIZE;
    this.maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
    this.queueCapacity = opts.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;
    // 启动 writer 协程（不阻塞构造；错误会在协程内部吞掉，避免 unhandled rejection）。
    void this.writerLoop();
  }

  write(record: LogRecord): void {
    if (this.closed) return;
    // 背压：超过容量时丢弃最旧记录
    if (this.queue.length >= this.queueCapacity) {
      this.queue.shift();
    }
    this.queue.push(record);
    // 唤醒 writer
    const p = this.pump;
    if (p) {
      this.pump = null;
      p();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 && !this.writing) return;
    await new Promise<void>((resolve) => {
      this.flushResolve = resolve;
      const p = this.pump;
      if (p) {
        this.pump = null;
        p();
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
    // 最终唤醒，让 writer 协程退出
    const p = this.pump;
    if (p) {
      this.pump = null;
      p();
    }
  }

  /** Writer 协程：等待唤醒后批量写盘。 */
  private async writerLoop(): Promise<void> {
    while (!this.closed || this.queue.length > 0) {
      if (this.queue.length === 0) {
        // 等待唤醒（直到 write()/flush()/close() 触发）
        await new Promise<void>((r) => {
          this.pump = () => r();
        });
        continue;
      }
      // 取当前全部记录
      const batch = this.queue;
      this.queue = [];
      this.writing = true;
      try {
        await this.writeBatch(batch);
      } catch {
        // writeBatch 内部已兜底错误；这里再兜一层防止意外泄漏
      } finally {
        this.writing = false;
        if (this.flushResolve && this.queue.length === 0) {
          const r = this.flushResolve;
          this.flushResolve = null;
          r();
        }
      }
    }
  }

  /** 写一批记录到当前文件（每条写入前检查轮转，避免单批过大绕过 size 限制）。 */
  private async writeBatch(records: LogRecord[]): Promise<void> {
    for (const r of records) {
      await this.ensureFile();
      const line = formatRecord(r) + "\n";
      const bytes = Buffer.byteLength(line, "utf8");
      // 当前文件已超标则先轮转（仅当非空时）
      if (this.currentSize + bytes > this.maxSize && this.currentSize > 0) {
        await this.rotate();
      }
      try {
        await appendFile(this.currentPath, line, "utf8");
        this.currentSize += bytes;
      } catch {
        // 写盘失败（磁盘满/权限）— 丢弃本条，避免无限重试
      }
    }
  }

  /** 确保当前日期对应的文件已打开。 */
  private async ensureFile(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.currentPath = join(this.dir, `voxcode.${today}.log`);
      await mkdir(this.dir, { recursive: true });
      try {
        const s = await stat(this.currentPath);
        this.currentSize = s.size;
      } catch {
        this.currentSize = 0;
      }
    }
  }

  /** 轮转：把当前文件重命名为 .N 后缀，清理旧文件。 */
  private async rotate(): Promise<void> {
    const basePath = this.currentPath;
    // 找已有轮转文件的最大序号
    let maxIdx = 0;
    try {
      const files = await readdir(this.dir);
      // basePath 形如 /abs/dir/voxcode.YYYY-MM-DD.log
      const baseName = basePath.replace(/\.log$/, "").replace(/^.*[\\/]/, "");
      const re = new RegExp(`^${escapeRegex(baseName)}\\.(\\d+)\\.log$`);
      for (const f of files) {
        const m = f.match(re);
        if (m) maxIdx = Math.max(maxIdx, Number(m[1]));
      }
    } catch {
      // ignore
    }
    const newPath = `${basePath.replace(/\.log$/, "")}.${maxIdx + 1}.log`;
    try {
      await rename(basePath, newPath);
    } catch {
      // rename 失败时放弃轮转，继续追加
    }
    this.currentSize = 0;
    await this.prune();
  }

  /** 清理超过 maxFiles 份的旧日志。 */
  private async prune(): Promise<void> {
    try {
      const files = await readdir(this.dir);
      const pattern = /^voxcode\.\d{4}-\d{2}-\d{2}(?:\.\d+)?\.log$/;
      const matches = files.filter((f) => pattern.test(f)).sort();
      // matches 按字典序 = 按时间从旧到新。保留最新 maxFiles 份。
      const toDelete = matches.slice(0, Math.max(0, matches.length - this.maxFiles));
      await Promise.all(toDelete.map((f) => unlink(join(this.dir, f)).catch(() => {})));
    } catch {
      // prune 失败不影响主流程
    }
  }
}

/** 格式化单条日志。 */
export function formatRecord(r: LogRecord): string {
  const level = LEVEL_LABEL[r.level];
  const ns = r.namespace.padEnd(10, " ").slice(0, 10);
  const metaStr = formatMeta(r.meta);
  return `[${r.time}] [${level}] [${ns}] ${r.message}${metaStr}`;
}

function formatMeta(meta: Record<string, unknown>): string {
  const keys = Object.keys(meta);
  if (keys.length === 0) return "";
  const parts: string[] = [];
  for (const k of keys) {
    const v = meta[k];
    if (v === undefined) continue;
    if (typeof v === "string") {
      parts.push(`${k}=${v}`);
    } else {
      try {
        parts.push(`${k}=${JSON.stringify(v)}`);
      } catch {
        parts.push(`${k}=[unserializable]`);
      }
    }
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function resolvePath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(2));
  }
  return resolve(p);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
