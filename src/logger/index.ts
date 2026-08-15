/**
 * Logger 接口与结构化日志记录。
 *
 * 核心设计：
 * - 5 级日志：debug / info / warn / error / fatal
 * - 命名空间：通过 child() 派生子 logger，输出自动加前缀
 * - 结构化 meta：每条日志可附带任意 JSON 字段
 * - 多 transport：同一日志可分发到文件 / 控制台 / 自定义 sink
 *
 * @module logger/index
 */

import type { LogLevel } from "./levels.js";
import { LEVEL_VALUE } from "./levels.js";

/** 单条日志记录。 */
export interface LogRecord {
  /** ISO 时间戳。 */
  time: string;
  /** 日志级别。 */
  level: LogLevel;
  /** 命名空间（如 "stt"、"executor"）。 */
  namespace: string;
  /** 消息正文。 */
  message: string;
  /** 结构化元数据（pid、exitCode 等）。 */
  meta: Record<string, unknown>;
}

/**
 * Transport：接收并输出日志记录。
 *
 * - write() 必须是非阻塞的（文件 transport 用队列批写；控制台 transport 直接写 stdout）。
 * - flush?() 用于优雅退出时等待队列清空。
 * - close?() 用于释放资源（关闭文件描述符）。
 */
export interface LogTransport {
  write(record: LogRecord): void;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

/** Logger 对外接口。 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  fatal(message: string, meta?: Record<string, unknown>): void;
  /** 派生子 logger（命名空间拼接，用 "." 分隔）。 */
  child(namespace: string): Logger;
  /** 等待所有 transport 队列排空（优雅关闭用）。 */
  flush(): Promise<void>;
  /** 关闭所有 transport。 */
  close(): Promise<void>;
}

/** Logger 构造选项。 */
export interface LoggerOptions {
  namespace?: string;
  level?: LogLevel;
  transports: LogTransport[];
}

/** Logger 默认实现。 */
export class LoggerImpl implements Logger {
  private readonly namespace: string;
  private readonly level: LogLevel;
  private readonly transports: LogTransport[];

  constructor(opts: LoggerOptions) {
    this.namespace = opts.namespace ?? "";
    this.level = opts.level ?? "info";
    this.transports = opts.transports;
  }

  debug(message: string, meta?: Record<string, unknown>): void { this.log("debug", message, meta); }
  info(message: string, meta?: Record<string, unknown>): void { this.log("info", message, meta); }
  warn(message: string, meta?: Record<string, unknown>): void { this.log("warn", message, meta); }
  error(message: string, meta?: Record<string, unknown>): void { this.log("error", message, meta); }
  fatal(message: string, meta?: Record<string, unknown>): void { this.log("fatal", message, meta); }

  child(namespace: string): Logger {
    const joined = this.namespace ? `${this.namespace}.${namespace}` : namespace;
    return new LoggerImpl({
      namespace: joined,
      level: this.level,
      transports: this.transports,
    });
  }

  async flush(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.flush?.()));
  }

  async close(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.close?.()));
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    // 级别过滤：当前级别数值 < 配置级别数值则跳过
    if (LEVEL_VALUE[level] < LEVEL_VALUE[this.level]) return;

    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      namespace: this.namespace,
      message,
      meta: meta ?? {},
    };

    for (const t of this.transports) {
      try {
        t.write(record);
      } catch {
        // transport 内部异常不应阻塞主流程；丢到 stderr 兜底。
        // eslint-disable-next-line no-console
        process.stderr.write(`[logger] transport write failed: level=${level} msg=${message}\n`);
      }
    }
  }
}

/** 创建根 logger 的便捷函数。 */
export function createLogger(opts: LoggerOptions): Logger {
  return new LoggerImpl(opts);
}
