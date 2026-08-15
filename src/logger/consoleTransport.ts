/**
 * 控制台 transport：彩色输出，开发模式使用。
 *
 * 颜色方案（ANSI 256 色）：
 * - debug : 灰（前景 242）
 * - info  : 绿（前景 34）
 * - warn  : 黄（前景 220）
 * - error : 红（前景 196）
 * - fatal : 红底白字（前景 15 背景 196）
 *
 * 命名空间使用青色（前景 51）区分层级。
 * 通过 NO_COLOR / FORCE_COLOR 环境变量检测是否输出颜色。
 *
 * @module logger/consoleTransport
 */

import type { LogRecord, LogTransport } from "./index.js";
import type { LogLevel } from "./levels.js";

/** ANSI 转义序列（256 色）。 */
const ESC = "\x1b[";
const ANSI = {
  reset: `${ESC}0m`,
  fg: (c: number): string => `${ESC}38;5;${c}m`,
  bg: (c: number): string => `${ESC}48;5;${c}m`,
};

/** 级别 → 前景色。 */
const LEVEL_COLOR: Record<LogLevel, number> = {
  debug: 242,
  info: 34,
  warn: 220,
  error: 196,
  fatal: 15,
};

/** 命名空间统一青色。 */
const NS_COLOR = 51;

export interface ConsoleTransportOptions {
  /** 输出目标，默认 process.stdout。 */
  stream?: NodeJS.WritableStream;
  /** 是否强制彩色输出（默认根据 TTY + 环境变量自动判断）。 */
  color?: boolean;
}

/**
 * 控制台 transport。
 *
 * 非 TTY 或 NO_COLOR=1 时自动关闭颜色（遵循 https://no-color.org/ 协议）。
 * FORCE_COLOR=1 可强制开启。
 */
export class ConsoleTransport implements LogTransport {
  private readonly stream: NodeJS.WritableStream;
  private readonly color: boolean;

  constructor(opts: ConsoleTransportOptions = {}) {
    this.stream = opts.stream ?? process.stdout;
    this.color = opts.color ?? detectColor(this.stream);
  }

  write(record: LogRecord): void {
    const line = this.format(record);
    try {
      this.stream.write(line + "\n");
    } catch {
      // 流写入失败（例如 stdout 已关闭）— 静默丢弃，不阻塞主流程
    }
  }

  private format(r: LogRecord): string {
    const levelLabel = r.level.toUpperCase().padEnd(5, " ");
    const ns = r.namespace.padEnd(10, " ").slice(0, 10);
    const metaStr = formatMeta(r.meta);

    if (!this.color) {
      return `[${r.time}] [${levelLabel}] [${ns}] ${r.message}${metaStr}`;
    }

    const colorCode = LEVEL_COLOR[r.level];
    const coloredLevel = `${ANSI.fg(colorCode)}${r.level === "fatal" ? ANSI.bg(196) : ""}${levelLabel}${ANSI.reset}`;
    const coloredNs = `${ANSI.fg(NS_COLOR)}${ns}${ANSI.reset}`;
    const coloredMsg = r.level === "fatal"
      ? `${ANSI.fg(15)}${ANSI.bg(196)}${r.message}${ANSI.reset}`
      : `${ANSI.fg(colorCode)}${r.message}${ANSI.reset}`;

    return `[${r.time}] [${coloredLevel}] [${coloredNs}] ${coloredMsg}${metaStr}`;
  }
}

/** 检测是否应启用彩色输出。 */
function detectColor(stream: NodeJS.WritableStream): boolean {
  // FORCE_COLOR 强制开启
  if (process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true") return true;
  // NO_COLOR 强制关闭（https://no-color.org/）
  if (process.env.NO_COLOR !== undefined) return false;
  // 非 TTY 默认关闭
  if (typeof (stream as { isTTY?: boolean }).isTTY !== "undefined") {
    return (stream as { isTTY?: boolean }).isTTY === true;
  }
  return false;
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
