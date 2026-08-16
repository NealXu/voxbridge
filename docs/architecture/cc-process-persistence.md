# CC 进程持久化架构

## 概述

VoxBridge 支持 CC（Claude Code）进程的持久化运行，通过进程池管理实现多轮对话的上下文保持和进程复用。

## 设计目标

| 目标 | 说明 |
|------|------|
| 减少启动开销 | 复用已有进程，避免每次输入重新创建 |
| 保持上下文 | 同一项目的多次对话共享会话上下文 |
| 资源管理 | 空闲超时自动回收，防止资源泄漏 |
| 多项目支持 | 不同目录使用独立进程，互不干扰 |

## 核心架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ExecutorRegistry                                   │
│                                                                             │
│  Map<chatId, RegistryEntry>                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  "d:/projects/myapp" → {                                            │   │
│  │    executor: PersistentClaudeExecutor,                              │   │
│  │    leases: 1,                                                        │   │
│  │    lastUsedAt: 1723795200000                                        │   │
│  │  }                                                                   │   │
│  │  "d:/projects/website" → { ... }                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  配置：                                                                      │
│  - maxConcurrent: 5（最多 5 个并发进程）                                      │
│  - idleTimeoutMs: 1800000（30 分钟空闲后回收）                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 关键组件

### DirectorySessionManager

目录驱动的 Session 管理器，将工作目录映射到 CC 进程。

```typescript
// src/session/directorySessionManager.ts
class DirectorySessionManager {
  private registry: ExecutorRegistry;
  private activeCwd: string;
  private knownProjects: Set<string>;
  
  async acquire(): Promise<RegistryEntry>;
  async release(reason: string): Promise<void>;
  async switchDirectory(newCwd: string): Promise<SwitchResult>;
  async shutdown(): Promise<void>;
}
```

### ExecutorRegistry

进程池实现，管理多个 PersistentClaudeExecutor 实例。

```typescript
// src/executor/registry.ts
class ExecutorRegistry {
  async acquire(chatId: string, opts: AcquireOptions): Promise<RegistryEntry>;
  async release(chatId: string, reason: string): Promise<void>;
  async shutdownAll(reason: string): Promise<void>;
}
```

### PersistentClaudeExecutor

持久执行器，支持多轮对话的 `nextTurn()` 方法。

```typescript
// src/executor/persistentExecutor.ts
class PersistentClaudeExecutor {
  nextTurn(prompt: string): TurnHandle;
  shutdown(reason: string): Promise<void>;
}
```

## 进程生命周期

```
┌──────────┐    acquire()    ┌──────────┐    release()    ┌──────────┐
│  创建    │ ─────────────→ │  活跃    │ ─────────────→ │  空闲    │
│ (spawn)  │                │ (active) │                │  (idle)  │
└──────────┘                └──────────┘                └──────────┘
                                                              │
                                                              │ idleTimeoutMs
                                                              ↓
                                                        ┌──────────┐
                                                        │  回收    │
                                                        │(dispose) │
                                                        └──────────┘
```

## chatId 生成规则

```typescript
function generateChatId(cwd: string): string {
  return resolve(cwd)
    .replace(/\\/g, '/')      // Windows 反斜杠转正斜杠
    .toLowerCase();            // 统一小写
}

// 示例
// Windows: D:\Projects\MyApp → d:/projects/myapp
// Unix:    /home/user/project → /home/user/project
```

## 配置项

```json
{
  "executor": {
    "mode": "sdk",
    "persistent": true,
    "idleTimeoutMs": 1800000,
    "maxConcurrent": 5
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| persistent | boolean | false | 启用持久进程池 |
| idleTimeoutMs | number | 1800000 | 空闲超时（毫秒） |
| maxConcurrent | number | 5 | 最大并发进程数 |

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 进程崩溃 | 从 Registry 移除，下次 acquire 自动重建 |
| 网络错误 | 进程保持运行，可直接重试 |
| 超时回收 | 自动 dispose，释放资源 |

## 多终端并行

每个 VoxBridge 实例拥有独立的 ExecutorRegistry，互不干扰：

```
终端 1: D:\Projects\app-a> voxbridge  → 独立进程池
终端 2: D:\Projects\app-b> voxbridge  → 独立进程池
```

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/session/directorySessionManager.ts` | 目录驱动 Session 管理 |
| `src/executor/registry.ts` | 进程池实现 |
| `src/executor/persistentExecutor.ts` | 持久执行器 |
| `src/session/agentSession.ts` | Session 集成入口 |

## 参考

- [Session 管理功能](../features/session-management.md)
- [历史设计文档](../archive/2026-08-16-session-strategies/)
