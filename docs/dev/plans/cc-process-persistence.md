# CC 进程持久化改进方案

## 问题分析

### 当前架构问题

```
现状：每次语音输入 → 新建 CC 进程 → 完成后退出

┌─────────────────────────────────────────────────────────────────────────────┐
│  用户语音输入 1          用户语音输入 2          用户语音输入 3              │
│       ↓                       ↓                       ↓                     │
│  ┌─────────┐             ┌─────────┐             ┌─────────┐               │
│  │ CC 进程 │             │ CC 进程 │             │ CC 进程 │               │
│  │ spawn   │             │ spawn   │             │ spawn   │               │
│  │ 执行    │             │ 执行    │             │ 执行    │               │
│  │ 退出    │             │ 退出    │             │ 退出    │               │
│  └─────────┘             └─────────┘             └─────────┘               │
│       ↓                       ↓                       ↓                     │
│  每次启动开销：           每次启动开销：           每次启动开销：            │
│  - 进程创建              - 进程创建              - 进程创建                 │
│  - SDK 初始化            - SDK 初始化            - SDK 初始化               │
│  - 会话加载              - 会话加载              - 会话加载                 │
│  - 上下文丢失            - 上下文丢失            - 上下文丢失                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 问题清单

| # | 问题 | 影响 |
|---|------|------|
| 1 | 每次输入启动新进程 | 进程创建开销大（~1-2秒） |
| 2 | CWD 固定为启动目录 | 无法在用户期望的项目目录工作 |
| 3 | 上下文在进程间丢失 | 无法保持长期对话记忆 |
| 4 | `ExecutorRegistry` 未被使用 | 进程池代码存在但未集成 |

### 代码现状

**已存在但未使用的组件**：

```typescript
// src/executor/registry.ts - 进程池（已实现但未使用）
export class ExecutorRegistry {
  async acquire(chatId: string, opts: AcquireOptions): Promise<RegistryEntry>;
  async release(chatId: string, reason: string): Promise<void>;
  // idleTimeoutMs 控制 idle 后自动回收
}

// src/executor/persistentExecutor.ts - 持久执行器（已实现但未使用）
export class PersistentClaudeExecutor {
  nextTurn(prompt: string): TurnHandle;  // 长生命周期的轮次
  shutdown(reason: string): Promise<void>;
}
```

**实际使用的组件**：

```typescript
// src/main.ts:59 - 使用短生命周期的 ClaudeExecutor
const session = createAgentSession({
  cwd: process.cwd(),  // ← 固定的工作目录
  executor,            // ← ClaudeExecutor（每次新建进程）
  ...
});
```

---

## 改进方案

### 方案概述

```
改进后：持久进程池 → 复用 CC 进程 → 按需回收

┌─────────────────────────────────────────────────────────────────────────────┐
│                           ExecutorRegistry                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  chatId: "default"                                                   │   │
│  │  cwd: "/path/to/user/project"                                       │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  PersistentClaudeExecutor                                    │   │   │
│  │  │  ┌─────────────────────────────────────────────────────┐   │   │   │
│  │  │  │  CC 进程（长期运行）                                  │   │   │   │
│  │  │  │  - 保持会话上下文                                     │   │   │   │
│  │  │  │  - 支持多轮对话                                       │   │   │   │
│  │  │  │  - idle 后 30 分钟自动回收                            │   │   │   │
│  │  │  └─────────────────────────────────────────────────────┘   │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  用户输入 1 → nextTurn() → 响应 → 等待                                       │
│  用户输入 2 → nextTurn() → 响应 → 等待    （复用同一进程）                     │
│  用户输入 3 → nextTurn() → 响应 → 等待                                       │
│       ↓                                                                     │
│  idle 30 分钟 → shutdown() → 进程回收                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 改进步骤

#### 步骤 1：配置文件扩展

```json
// config.json 新增配置项
{
  "executor": {
    "mode": "sdk",
    "persistent": true,
    "idleTimeoutMs": 1800000,
    "maxConcurrent": 5,
    "cwd": null  // ← 新增：默认工作目录，null 表示使用启动目录
  },
  
  // 或者：启动时通过命令行指定
  // voxbridge --cwd /path/to/project
}
```

#### 步骤 2：集成 ExecutorRegistry

修改 `src/session/agentSession.ts`：

```typescript
import { ExecutorRegistry, PersistentClaudeExecutor } from "../executor/index.js";

// 创建进程池（单例）
let registry: ExecutorRegistry | null = null;

function getRegistry(config: Config): ExecutorRegistry {
  if (!registry) {
    registry = new ExecutorRegistry({
      idleTimeoutMs: config.executor?.idleTimeoutMs ?? 1800000,
      maxConcurrent: config.executor?.maxConcurrent ?? 5,
      logger: console,
    });
  }
  return registry;
}

export function createAgentSession(opts: AgentSessionOptions): AgentSession {
  const { config, cwd, callbacks } = opts;
  
  // 使用持久执行器
  if (config.executor?.persistent) {
    const registry = getRegistry(config);
    const chatId = "default";  // 或基于 cwd 生成唯一 ID
    
    return {
      async send(prompt: string): Promise<SendResult> {
        const entry = await registry.acquire(chatId, { cwd });
        try {
          const turn = entry.executor.nextTurn(prompt);
          // 处理 turn.stream...
          return { ok: true };
        } finally {
          await registry.release(chatId, "turn complete");
        }
      },
      reset(): void { /* ... */ }
    };
  }
  
  // 回退到短生命周期执行器
  // ... 现有代码 ...
}
```

#### 步骤 3：动态 CWD 支持

**方案 A：配置文件指定**

```json
{
  "executor": {
    "cwd": "D:\\Projects\\my-project"
  }
}
```

**方案 B：命令行参数**

```bash
voxbridge --cwd /path/to/project
voxbridge -C /path/to/project
```

**方案 C：交互式切换**

```
用户：切换到项目目录 D:\Projects\my-project
VoxBridge：已切换工作目录，CC 进程将在新目录重启
```

#### 步骤 4：进程生命周期管理

```typescript
// 进程状态机
type ProcessState = 
  | "idle"      // 等待输入
  | "active"    // 处理请求
  | "shutting-down";  // 正在关闭

class ProcessManager {
  private registry: ExecutorRegistry;
  private state: ProcessState = "idle";
  
  // 用户输入 → 激活进程
  async onUserInput(prompt: string): Promise<void> {
    this.state = "active";
    const entry = await this.registry.acquire("default", { cwd: this.cwd });
    // 处理...
  }
  
  // 完成 → 返回 idle
  async onComplete(): Promise<void> {
    this.state = "idle";
    await this.registry.release("default", "turn complete");
  }
  
  // idle 超时 → 自动回收
  // 由 ExecutorRegistry 内部处理
}
```

---

## 详细设计

### 1. 工作目录策略

```
优先级：命令行参数 > 配置文件 > 启动目录

┌─────────────────────────────────────────────────────────────────────────────┐
│                              CWD 选择逻辑                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 检查命令行参数 --cwd / -C                                                │
│     ↓ (无)                                                                  │
│  2. 检查配置文件 executor.cwd                                                │
│     ↓ (无)                                                                  │
│  3. 使用 process.cwd()                                                      │
│                                                                             │
│  结果：确定初始 CWD                                                          │
│                                                                             │
│  后续：支持运行时切换（需要重启 CC 进程）                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. 进程池架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ExecutorRegistry                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Map<chatId, RegistryEntry>                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  "default" → {                                                       │   │
│  │    executor: PersistentClaudeExecutor,                              │   │
│  │    leases: 1,                                                        │   │
│  │    lastUsedAt: 1723795200000                                        │   │
│  │  }                                                                   │   │
│  │  "project-A" → { ... }                                              │   │
│  │  "project-B" → { ... }                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  配置：                                                                      │
│  - maxConcurrent: 5（最多 5 个并发进程）                                      │
│  - idleTimeoutMs: 1800000（30 分钟空闲后回收）                                │
│                                                                             │
│  方法：                                                                      │
│  - acquire(chatId, { cwd }) → RegistryEntry                                │
│  - release(chatId, reason) → void                                          │
│  - shutdownAll(reason) → void                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3. 会话绑定

```typescript
// 每个 chatId 绑定一个 CWD
interface ChatBinding {
  chatId: string;
  cwd: string;
  sessionId?: string;  // CC session ID
  createdAt: number;
}

// 单目录场景：固定 chatId = "default"
// 多目录场景：chatId = hash(cwd) 或用户命名
```

### 4. 错误处理

```typescript
// 进程崩溃 → 自动重启
async function handleExecutorError(error: unknown): Promise<void> {
  // 1. 记录错误
  logger.error("executor error", { error });
  
  // 2. 标记进程失效
  await registry.dispose("default", "error");
  
  // 3. 下次 acquire 时自动创建新进程
}
```

---

## 实施计划

### Phase 1：基础集成（优先）

1. 修改 `createAgentSession` 使用 `ExecutorRegistry`
2. 添加 `--cwd` 命令行参数支持
3. 确保基本功能正常（单目录、持久进程）

### Phase 2：增强功能

1. 运行时切换工作目录
2. 多项目并行支持（多 chatId）
3. 进程状态监控

### Phase 3：用户体验

1. UI 显示当前工作目录
2. 切换目录时的提示
3. 进程池状态可视化

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 进程泄漏 | 内存/CPU 占用 | idleTimeoutMs 自动回收 + 强制清理 |
| CWD 切换不生效 | 用户困惑 | 明确提示需要重启进程 |
| 多进程冲突 | 资源争用 | maxConcurrent 上限 + LRU 驱逐 |

---

## 参考

- `src/executor/registry.ts` - 进程池实现
- `src/executor/persistentExecutor.ts` - 持久执行器实现
- `src/session/agentSession.ts` - 当前会话管理
- `docs/use/user-guide.md` - 用户文档