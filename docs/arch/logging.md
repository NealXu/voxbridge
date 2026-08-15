# VoxBridge 日志系统

- **版本**�?.3.0�?026-08-15�?
- **关联**：`config.json`、`src/logger/`

---

## 1. 概述

VoxBridge 使用结构化日志系统，替代原先硬编码的 `VoxBridge-debug.log`（已移除）。日志按**级别** / **命名空间** / **时间**三维组织，便于生产环境排查与优化�?

**关键特�?*�?
- 5 级日志：`debug` / `info` / `warn` / `error` / `fatal`
- 命名空间：`main` / `stt.worker` / `executor` / `session` / `trigger.*`
- 异步写盘：内存队�?+ �?writer 协程，永不阻塞业务线�?
- 自动轮转：按日期分文�?+ 按大小（10MB）切分，保留 5 �?
- 结构�?meta：键值对直接追加到消息后（如 `pid=1234 exitCode=0`�?

---

## 2. 配置

`config.json` 新增 `logging` 字段�?

```jsonc
{
  "logging": {
    "level": "info",                 // debug | info | warn | error | fatal
    "dir": "~/.VoxBridge/logs",        // 日志目录（支�?~ 展开�?
    "maxSize": 10485760,             // 单文件最大字节数�?0MB�?
    "maxFiles": 5,                   // 保留历史文件�?
    "enableConsole": false           // 是否同时输出到控制台（开发用�?
  }
}
```

**环境变量覆盖**（优先级高于配置文件）：
- `VoxBridge_LOG_LEVEL=debug`：覆盖级�?
- `VoxBridge_LOG_CONSOLE=1`：强制开启控制台输出

---

## 3. 日志格式

```
[2026-08-15T10:23:45.123Z] [INFO ] [stt.worker] worker spawned pid=1234
[2026-08-15T10:23:50.456Z] [ERROR] [executor   ] cc crashed exitCode=1 signal=null
[2026-08-15T10:23:51.789Z] [WARN ] [session    ] resuming session failed, clearing sessionId
```

字段�?
- 时间戳（ISO 8601，毫秒精度）
- 级别�? 字符，空格对齐）
- 命名空间�?0 字符，padEnd�?
- 消息正文
- 结构�?meta（`key=value` 键值对，空格分隔）

---

## 4. 命名空间清单

| 命名空间 | 模块 | 关键事件 |
|---|---|---|
| `main` | `src/main.ts` | 启动、SIGINT、worker 崩溃计数 |
| `stt.worker` | `src/stt/workerClient.ts` | spawn、ready、exit、error |
| `session` | `src/session/agentSession.ts` | resume、send、complete、error、reset |
| `trigger` | `src/trigger/index.ts` | 模式选择 |
| `trigger.global` | `src/trigger/index.ts` | 全局热键 DOWN/UP |
| `trigger.terminal` | `src/trigger/index.ts` | 终端触发 toggle/cancel |
| `trigger.keys` | `src/trigger/terminalKeys.ts` | 按键序列解析（debug�?|

---

## 5. 日志文件位置

- 默认：`~/.VoxBridge/logs/VoxBridge.YYYY-MM-DD.log`
- 轮转后：`~/.VoxBridge/logs/VoxBridge.YYYY-MM-DD.N.log`（N 为序号）
- 总容量上限：`maxFiles × maxSize = 5 × 10MB = 50MB`

---

## 6. 日志清理

手动清理 30 天前的日志：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/cleanup-logs.ps1
```

�?PowerShell 一行命令：

```powershell
Get-ChildItem "$env:USERPROFILE\.VoxBridge\logs\*.log" | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item
```

---

## 7. 开发模�?

启用彩色控制台输出（便于调试）：

```bash
VoxBridge_LOG_CONSOLE=1 VoxBridge_LOG_LEVEL=debug npm start
```

---

## 8. 迁移说明（从 VoxBridge-debug.log�?

旧版本（<0.3.0）在当前目录生成 `VoxBridge-debug.log`（同步写盘，无轮转）。新版本�?

- �?不再写入 `./VoxBridge-debug.log`
- �?改为 `~/.VoxBridge/logs/VoxBridge.YYYY-MM-DD.log`
- �?异步写盘，无性能影响
- �?自动轮转，无需手动清理

旧日志文件可手动删除�?

```powershell
Remove-Item ./VoxBridge-debug.log -ErrorAction SilentlyContinue
```
