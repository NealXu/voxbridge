/**
 * 根 logger 工厂：根据 Config 创建统一的 logger 实例。
 *
 * 默认行为：
 * - 文件 transport 始终启用，写入 `config.logging.dir`（默认 `~/.voxcode/logs`）。
 * - 控制台 transport 通过 `config.logging.enableConsole` 或 `VOXCODE_LOG_CONSOLE=1` 开启。
 * - 级别通过 `config.logging.level` 或 `VOXCODE_LOG_LEVEL` 环境变量覆盖。
 *
 * @module logger/factory
 */

import type { Config } from "../config.js";
import { createLogger } from "./index.js";
import type { Logger, LogTransport } from "./index.js";
import { FileTransport } from "./fileTransport.js";
import { ConsoleTransport } from "./consoleTransport.js";
import { parseLogLevel } from "./levels.js";
import type { LogLevel } from "./levels.js";

/** 应用级日志配置（从 Config 提取）。 */
export interface LoggingConfig {
  level?: LogLevel;
  dir?: string;
  maxSize?: number;
  maxFiles?: number;
  enableConsole?: boolean;
}

/** 创建应用根 logger。返回的 logger 可派生子 logger 给各模块。 */
export function createRootLogger(logging: LoggingConfig | undefined): Logger {
  const cfg = logging ?? {};

  // 级别：环境变量优先 > 配置文件 > 默认 info
  const level = parseLogLevel(process.env.VOXCODE_LOG_LEVEL, cfg.level ?? "info");

  const transports: LogTransport[] = [];

  // 文件 transport 始终启用
  transports.push(
    new FileTransport({
      dir: cfg.dir ?? "~/.voxcode/logs",
      maxSize: cfg.maxSize,
      maxFiles: cfg.maxFiles,
    })
  );

  // 控制台 transport：显式开关 或 环境变量
  const consoleEnabled = cfg.enableConsole ?? process.env.VOXCODE_LOG_CONSOLE === "1";
  if (consoleEnabled) {
    transports.push(new ConsoleTransport());
  }

  return createLogger({ level, transports });
}

/** 便捷：从 Config 对象创建根 logger。 */
export function createLoggerFromConfig(config: Config): Logger {
  return createRootLogger(config.logging);
}
