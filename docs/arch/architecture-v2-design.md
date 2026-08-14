# voxcode 架构重构设计

- **日期**：2026-08-14
- **版本**：0.2.0
- **状态**：设计已确认，待实施

---

## 1. 动机

### 1.1 当前问题

当前 voxcode 直接调用 AI API，**没有利用 Claude Code 的完整能力**：

```
当前架构：
┌─────────────────────────────────────────────────────────────┐
│  voxcode (语音助手)                                           │
│                                                             │
│  ┌──────────────┐    ┌────────────────────────────────┐    │
│  │ 语音识别      │───→│ Agent SDK query()               │    │
│  │ (Whisper)    │    │ 直接调用 AI API                   │    │
│  └──────────────┘    └────────────────────────────────┘    │
│                               │                              │
│                               ▼                              │
│                    ┌─────────────────────┐                  │
│                    │  AI API (云端)       │                  │
│                    │  DeepSeek/Anthropic │                  │
│                    └─────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘

问题：
- 只能做简单的问答
- 无法执行 coding 任务（读写文件、运行命令、调试）
- 失去了 Claude Code 的工具链能力
```

### 1.2 目标设计

**voxcode 作为语音控制器，启动并控制本地 Claude Code 实例执行 coding 任务**：

```
目标架构：
┌─────────────────────────────────────────────────────────────┐
│  voxcode (语音控制器)                                         │
│                                                             │
│  ┌──────────────┐    ┌────────────────────────────────┐    │
│  │ 语音识别      │───→│ Claude Code Executor            │    │
│  │ (Whisper)    │    │ spawn('claude', [...])          │    │
│  └──────────────┘    └────────────────────────────────┘    │
│                               │                              │
│                               ▼                              │
│                    ┌─────────────────────┐                  │
│                    │ Claude Code 实例     │ ← 完整的 cc 能力 │
│                    │ - 读写文件           │                  │
│                    │ - 运行命令           │                  │
│                    │ - 调试代码           │                  │
│                    │ - 工具链             │                  │
│                    └─────────────────────┘                  │
│                               │                              │
│                               ▼                              │
│                    ┌─────────────────────┐                  │
│                    │  AI API (云端)       │                  │
│                    └─────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 参考架构：MetaBot

### 2.1 MetaBot 的核心机制

MetaBot 通过两种模式控制 Claude Code：

#### A. SDK 模式（主要方式）

```typescript
// executor.ts 核心代码
import { query } from '@anthropic-ai/claude-agent-sdk';

const stream = query({
  prompt: userInput,
  options: {
    cwd: workingDirectory,
    resume: sessionId,
    permissionMode: 'bypassPermissions',
    spawnClaudeCodeProcess: (options) => {
      return spawn('claude', options.args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    },
  },
});

// 消费 JSONL 流
for await (const msg of stream) {
  // 处理消息...
}
```

**关键参数：**
- `--session-id` / `--resume`：会话持久化
- `--dangerously-skip-permissions`：跳过交互确认
- `--settings`：自定义配置路径
- `--model`：模型选择

#### B. PTY 模式（交互式菜单）

```typescript
// pty-session.ts 核心代码
import * as pty from 'node-pty';

const term = pty.spawn('claude', [
  '--session-id', sessionId,
  '--dangerously-skip-permissions',
], {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: workingDirectory,
});

// 等待 TUI 就绪
await waitForReady(term);

// 输入 prompt
term.write(prompt + '\r');
```

### 2.2 持久执行器池

MetaBot 维护一个执行器池，每个 chatId 对应一个长期运行的 cc 进程：

```typescript
// ExecutorRegistry 管理 cc 进程池
class ExecutorRegistry {
  private executors = new Map<string, PersistentClaudeExecutor>();

  async acquire(chatId: string, options) {
    if (!this.executors.has(chatId)) {
      this.executors.set(chatId, new PersistentClaudeExecutor(options));
    }
    return this.executors.get(chatId);
  }

  async release(chatId: string) {
    const exec = this.executors.get(chatId);
    if (exec) {
      await exec.shutdown();
      this.executors.delete(chatId);
    }
  }
}
```

---

## 3. voxcode 架构设计

### 3.1 新架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│  用户终端 (Windows Terminal / PowerShell)                                 │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  voxcode (Node.js 主进程)                                            ││
│  │                                                                      ││
│  │  ┌──────────────┐  ┌─────────────────┐  ┌───────────────────────┐  ││
│  │  │ Trigger       │  │ CC Executor      │  │ Terminal UI            │  ││
│  │  │              │→ │                 │→ │ (ANSI console / ink)   │  ││
│  │  │ F9/Esc/      │  │ spawn claude    │  │                       │  ││
│  │  │ WakeWord     │  │ process         │  │ 状态/识别/回复/进度     │  ││
│  │  └──────────────┘  └────────┬────────┘  └───────────────────────┘  ││
│  │                             │                                        ││
│  │  ┌──────────────────────────┼────────────────────────────────────┐ ││
│  │  │                          ▼                                      │ ││
│  │  │  ┌─────────────────────────────────────────────────────────┐   │ ││
│  │  │  │  Claude Code 实例 (子进程)                                │   │ ││
│  │  │  │                                                          │   │ ││
│  │  │  │  能力：                                                   │   │ ││
│  │  │  │  ├─ 读写文件 (Write/Edit/Read)                           │   │ ││
│  │  │  │  ├─ 运行命令 (Bash)                                       │   │ ││
│  │  │  │  ├─ 代码搜索 (Grep/Glob)                                  │   │ ││
│  │  │  │  ├─ Git 操作                                              │   │ ││
│  │  │  │  ├─ 工具链                                                │   │ ││
│  │  │  │  └─ Agent Teams（可选）                                   │   │ ││
│  │  │  │                                                          │   │ ││
│  │  │  │  通信：                                                   │   │ ││
│  │  │  │  ├─ JSONL stream (SDK)                                   │   │ ││
│  │  │  │  └─ ~/.claude/projects/<cwd>/<session>.jsonl             │   │ ││
│  │  │  └──────────────────────────────────────────────────────────┘   │ ││
│  │  └──────────────────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  Python STT Worker (子进程)                                          ││
│  │                                                                      ││
│  │  ┌─────────┐  ┌──────┐  ┌─────────────────────────────┐            ││
│  │  │ Recorder │→│ VAD  │→│ WhisperEngine                │            ││
│  │  │ sound-   │  │能量/ │  │ faster-whisper large-v3     │            ││
│  │  │ device   │  │silero│  │ (3GB, CPU, int8)           │            ││
│  │  └─────────┘  └──────┘  └─────────────────────────────┘            ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
                             │
                             │ HTTPS (Anthropic API 兼容)
                             ▼
                  ┌─────────────────────┐
                  │  AI API 网关          │
                  │  DeepSeek / Anthropic │
                  └─────────────────────┘
```

### 3.2 模块变更

| 模块 | 当前实现 | 新实现 | 变更说明 |
|---|---|---|---|
| **src/session/** | 直接调用 Agent SDK query() | 通过 SDK 启动 cc 子进程 | 核心变更 |
| **src/executor/** | 不存在 | 新增：管理 cc 进程生命周期 | 新模块 |
| **stt_worker/** | 不变 | 不变 | 无变更 |
| **src/trigger/** | 不变 | 不变 | 无变更 |
| **src/ui/** | 显示简单文本 | 增强：显示工具调用、文件变更 | UI 增强 |

### 3.3 新增模块

#### src/executor/ 目录

```
src/executor/
├── index.ts                 # 工厂函数
├── claudeExecutor.ts        # SDK 模式封装
├── sessionManager.ts        # 会话持久化
├── streamProcessor.ts       # JSONL 流处理
├── types.ts                 # 类型定义
└── pty/                     # PTY 模式（可选，用于交互菜单）
    ├── ptySession.ts
    └── screenWatcher.ts
```

---

## 4. 核心接口设计

### 4.1 ClaudeExecutor

```typescript
// src/executor/types.ts
export interface ClaudeExecutorOptions {
  cwd: string;                    // 工作目录
  sessionId?: string;             // 会话 ID（续接）
  model?: string;                 // 模型选择
  systemPrompt?: string;          // 系统提示词追加
  abortController: AbortController;
  outputsDir?: string;            // 输出文件目录
  onTeamEvent?: (event: TeamEvent) => void;
}

export interface ExecutionHandle {
  stream: AsyncGenerator<SDKMessage>;
  sendAnswer(toolUseId: string, sessionId: string, answer: string): void;
  resolveQuestion(toolUseId: string, answers: Record<string, string>): void;
  finish(): void;
}

export interface SDKMessage {
  type: string;
  subtype?: string;
  uuid?: string;
  session_id?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: unknown;
    }>;
  };
  // 流式事件
  event?: {
    type: string;
    delta?: { text?: string };
  };
  // 结果
  result?: string;
  duration_ms?: number;
  total_cost_usd?: number;
}
```

### 4.2 核心实现

```typescript
// src/executor/claudeExecutor.ts
import { spawn } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';

export class ClaudeExecutor {
  private claudePath: string;

  constructor(private logger: Logger) {
    this.claudePath = this.resolveClaudePath();
  }

  private resolveClaudePath(): string {
    if (process.env.CLAUDE_EXECUTABLE_PATH) {
      return process.env.CLAUDE_EXECUTABLE_PATH;
    }
    // Windows: where, Unix: which
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    return execSync(cmd, { encoding: 'utf-8' }).trim().split(/\r?\n/)[0];
  }

  startExecution(options: ClaudeExecutorOptions): ExecutionHandle {
    const inputQueue = new AsyncQueue<SDKUserMessage>();

    // 推入初始消息
    inputQueue.enqueue({
      type: 'user',
      message: { role: 'user', content: options.prompt },
      parent_tool_use_id: null,
      session_id: options.sessionId || '',
    });

    const queryOptions = {
      cwd: options.cwd,
      resume: options.sessionId,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      spawnClaudeCodeProcess: (spawnOpts: SpawnOptions) => {
        return spawn(this.claudePath, spawnOpts.args, {
          cwd: spawnOpts.cwd,
          env: this.buildEnv(spawnOpts.env),
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      },
      pathToClaudeCodeExecutable: this.claudePath,
      settingSources: ['user', 'project'],
      includePartialMessages: true,
    };

    const stream = query({
      prompt: inputQueue,
      options: queryOptions,
    });

    return {
      stream: this.wrapStream(stream, options.abortController),
      sendAnswer: (toolUseId, sid, answer) => {
        inputQueue.enqueue({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUseId, content: answer }],
          },
          parent_tool_use_id: null,
          session_id: sid,
        });
      },
      resolveQuestion: (toolUseId, answers) => {
        // 处理 AskUserQuestion
      },
      finish: () => inputQueue.finish(),
    };
  }

  private buildEnv(overrides?: Record<string, string>): Record<string, string> {
    const env = { ...process.env, ...overrides };
    // 过滤 CLAUDE* 环境变量（防止嵌套会话错误）
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE') && !this.isSafeClaudeEnv(key)) {
        delete env[key];
      }
    }
    return env;
  }

  private isSafeClaudeEnv(key: string): boolean {
    const SAFE = new Set([
      'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
      'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
    ]);
    return SAFE.has(key);
  }
}
```

### 4.3 消息流处理

```typescript
// src/executor/streamProcessor.ts
export class StreamProcessor {
  private state: CardState = {
    status: 'thinking',
    userPrompt: '',
    responseText: '',
    toolCalls: [],
  };

  processMessage(msg: SDKMessage): CardState {
    // 处理流式 delta
    if (msg.event?.type === 'content_block_delta') {
      const text = msg.event.delta?.text;
      if (text) {
        this.state.responseText += text;
      }
    }

    // 处理工具调用
    if (msg.type === 'tool_use') {
      this.state.toolCalls.push({
        name: msg.message?.content?.[0]?.name,
        status: 'running',
      });
    }

    // 处理完成
    if (msg.type === 'result') {
      this.state.status = 'complete';
      this.state.durationMs = msg.duration_ms;
      this.state.costUsd = msg.total_cost_usd;
    }

    return { ...this.state };
  }
}
```

---

## 5. 会话管理

### 5.1 会话持久化

```
~/.claude/projects/<escaped-cwd>/<session-id>.jsonl
```

**路径规则：**
- `escaped-cwd`：工作目录路径，`/` 替换为 `-`
- 示例：`D:\Codes\voxcode` → `D--Codes-voxcode`

### 5.2 会话续接流程

```
启动 voxcode
    │
    ├─ loadSessionId() → ~/.voxcode-session.json
    │   └─ 读取上次 sessionId
    │
    ├─ 用户语音输入
    │
    └─ runOneTurn()
        ├─ 有 sessionId → query({ resume: sessionId })
        └─ 无 sessionId → query({ }) → 保存新 sessionId
```

### 5.3 会话状态文件

```json
// ~/.voxcode-session.json
{
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "cwd": "D:\\Codes\\voxcode",
  "lastUsed": "2026-08-14T21:00:00Z"
}
```

---

## 6. UI 增强

### 6.1 新增显示内容（已确认：完整版）

| 元素 | 显示时机 | 说明 |
|---|---|---|
| **工具调用** | tool_use 事件 | 显示 `▶ Write`, `▶ Bash` 等 |
| **文件变更** | Write/Edit 完成 | 显示文件路径和变更摘要 |
| **命令输出** | Bash 完成 | 显示命令和关键输出 |
| **耗时/成本** | result 事件 | 显示耗时和 API 成本 |
| **队友状态** | Team 事件 | 显示 teammates + tasks 面板 |

### 6.2 UI 接口扩展

```typescript
// src/ui/types.ts
export interface UI {
  // 现有接口...
  printStatus(text: string): void;
  printRecognition(text: string): void;
  printAssistantDelta(text: string): void;

  // 新增接口
  printToolCall(tool: ToolCallInfo): void;
  printToolResult(tool: string, result: string): void;
  printFileChange(file: string, action: 'create' | 'modify' | 'delete'): void;
  printCommand(cmd: string, output?: string): void;
  printCompletion(stats: CompletionStats): void;
  printTeamState(team: TeamState): void;
}

export interface ToolCallInfo {
  name: string;
  input?: Record<string, unknown>;
  status: 'running' | 'complete' | 'error';
}

export interface CompletionStats {
  durationMs: number;
  costUsd?: number;
  turns: number;
}

export interface TeamState {
  name?: string;
  teammates: TeamMember[];
  tasks: TeamTask[];
}

export interface TeamMember {
  name: string;
  status: 'idle' | 'working';
  lastSubject?: string;
}

export interface TeamTask {
  taskId: string;
  subject: string;
  status: 'in_progress' | 'completed';
  teammate?: string;
}
```

---

## 7. 配置扩展

### 7.1 config.json 新增字段

```jsonc
{
  // ─── 执行器配置（新增）───
  "executor": {
    "mode": "sdk",                    // "sdk" | "pty"
    "persistent": true,               // 持久进程池
    "idleTimeoutMs": 1800000,         // 空闲超时（30分钟）
    "maxConcurrent": 5                // 最大并发数
  },

  // ─── Claude Code 配置（新增）───
  "claude": {
    "path": "claude",                 // cc 二进制路径
    "settingsPath": "~/.claude/settings.json",
    "appendSystemPrompt": "",         // 系统提示词追加
    "model": "claude-opus-5"          // 模型选择
  },

  // ─── 现有配置保持不变 ───
  "stt": { ... },
  "trigger": { ... },
  "ui": { ... }
}
```

---

## 8. 安全考虑

### 8.1 权限模型

| 场景 | 处理方式 |
|---|---|
| 文件操作 | cc 在 cwd 内操作，继承 Claude Code 权限 |
| 命令执行 | `bypassPermissions` 模式，语音确认即可 |
| API 调用 | cc 通过 HTTPS 直接调 API，token 不经 voxcode |

### 8.2 敏感数据流

```
用户语音 → Whisper（本地） → 文本
                                      ↓
                               voxcode 主进程
                                      ↓
                          Claude Code 子进程
                                      ↓
                               HTTPS → AI API
```

**关键点：**
- API Token 只在 `~/.claude/settings.json`
- voxcode 不处理 Token
- 语音数据不落盘、不传输

---

## 9. 实施计划

### 9.1 阶段划分

| 阶段 | 内容 | 预计时间 | 状态 |
|---|---|---|---|
| **P0** | 基础 SDK 模式实现 | 2 天 | 必做 |
| **P1** | 会话持久化 + UI 增强（完整版） | 1 天 | 必做 |
| **P2** | 错误处理 + 崩溃恢复 | 1 天 | 必做 |
| **P3** | PTY 模式 | 1 天 | 可选（按需） |
| **P4** | 持久进程池 + Agent Teams | 2 天 | **必做** |

### 9.2 P0 详细任务

1. **创建 src/executor/ 目录结构**
2. **实现 ClaudeExecutor 类**
3. **实现 StreamProcessor**
4. **修改 src/session/ 使用新 executor**
5. **编写单元测试**
6. **集成测试验证**

### 9.3 P4 详细任务（Agent Teams）

Agent Teams 需要持久进程池支持，让队友跨轮存活：

1. **实现 ExecutorRegistry** — 管理 cc 进程池，按 chatId 映射
2. **实现 PersistentClaudeExecutor** — 长期运行的 cc 进程，支持跨轮输入队列
3. **启用 Agent Teams 环境变量** — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
4. **Team 事件透传** — TaskCreated / TaskCompleted / TeammateIdle 钩子
5. **UI 显示** — 队友状态面板（teammates + tasks）
6. **测试** — 多 agent 并行任务、teammate 状态更新

**持久进程池关键设计：**

```typescript
// src/executor/registry.ts
class ExecutorRegistry {
  private executors = new Map<string, PersistentClaudeExecutor>();
  private idleTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  async acquire(chatId: string, options: AcquireOptions): Promise<PersistentClaudeExecutor> {
    // 已存在 → 刷新空闲计时器并返回
    // 不存在 → 创建新实例（spawn cc 进程 + 输入队列）
  }

  async release(chatId: string, reason: string): Promise<void> {
    // 优雅关闭：finish 输入队列 → 等待流结束 → kill 兜底
  }

  async shutdownAll(reason: string): Promise<void> {
    // 遍历所有实例释放
  }
}
```

**Agent Teams 环境变量：**

```
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1    # 启用
teammateMode: 'in-process'                # 无终端时强制进程内模式
```

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| SDK API 变更 | 高 | 锁定 SDK 版本，添加版本检查 |
| cc 进程泄漏 | 中 | 实现超时清理 + 进程池管理 |
| 会话状态不一致 | 中 | 保存 cwd + sessionId，启动时校验 |
| 内存占用增加 | 低 | 限制最大并发数 |

---

## 11. 讨论点

### 11.1 已确认决策（2026-08-14）

| 决策 | 结论 | 影响 |
|---|---|---|
| **Agent Teams** | ✅ 需要 | P4 持久进程池升级为必做 |
| **UI 增强** | ✅ 完整版（工具调用 + 文件变更 + 成本） | P1 范围明确 |
| **配置项命名** | ✅ 合理（`executor` / `claude`） | 无需变更 |
| **PTY 模式** | 保留为可选 | 按需实现 |
| **/background 后台任务** | 依赖持久进程池 | P4 一并支持 |

### 11.2 待后续确认

- [ ] 是否需要 `/background` 后台任务支持？
- [ ] 队友数量上限？
- [ ] 进程池空闲回收策略？

---

## 附录 A：MetaBot 关键代码摘录

```typescript
// 创建 spawn 函数（过滤环境变量）
function createSpawnFn(explicitApiKey?: string) {
  return (options: SpawnOptions): SpawnedProcess => {
    const env = { ...process.env, ...options.env };

    // 过滤 CLAUDE* 环境变量
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE') && !CLAUDE_ENV_PASSTHROUGH.has(key)) {
        delete env[key];
      }
    }

    // 注入 API Key
    if (explicitApiKey) {
      env.ANTHROPIC_API_KEY = explicitApiKey;
    }

    return spawn(options.command, options.args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  };
}

// JSONL 路径计算
const escapedCwd = resolvedCwd.replace(/\//g, '-');
const jsonlPath = path.join(
  os.homedir(),
  '.claude',
  'projects',
  escapedCwd,
  `${sessionId}.jsonl`,
);
```

---

## 附录 B：类型定义完整版

```typescript
// src/executor/types.ts

export type TeamEvent =
  | { kind: 'task_created'; taskId: string; subject: string; teammate?: string }
  | { kind: 'task_completed'; taskId: string; subject: string; teammate?: string }
  | { kind: 'teammate_idle'; teammate: string };

export interface ExecutorOptions {
  cwd: string;
  sessionId?: string;
  model?: string;
  systemPromptAppend?: string;
  abortController: AbortController;
  outputsDir?: string;
  onTeamEvent?: (event: TeamEvent) => void;
  maxTurns?: number;
  allowedTools?: string[];
}

export interface ExecutionHandle {
  stream: AsyncGenerator<SDKMessage>;
  sendAnswer(toolUseId: string, sessionId: string, answer: string): void;
  resolveQuestion(toolUseId: string, answers: Record<string, string>): void;
  finish(): void;
}

export interface CardState {
  status: 'thinking' | 'running' | 'waiting_for_input' | 'complete' | 'error';
  userPrompt: string;
  responseText: string;
  toolCalls: ToolCall[];
  errorMessage?: string;
  durationMs?: number;
  costUsd?: number;
}

export interface ToolCall {
  name: string;
  status: 'running' | 'complete' | 'error';
  input?: unknown;
  result?: string;
}
```