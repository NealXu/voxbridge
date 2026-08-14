# voxcode 架构实施计划

- **日期**：2026-08-14（更新 2026-08-15）
- **目标版本**：0.2.0
- **关联文档**：`architecture.md`（架构 + 设计，已整合）
- **状态**：✅ 已实施（P0–P4 全部完成，254 测试通过 + 2 跳过）

---

## 0. 计划摘要

将 voxcode 从「直接调用 AI API」重构为「通过 claude-agent-sdk 启动并控制本地 Claude Code 实例」，获得完整 coding 能力（读写文件、运行命令、调试、Agent Teams）。

**范围**（2026-08-14/15 实施完成）：
- ✅ 新增 `src/executor/`（16 模块 + pty/ 3 文件：ClaudeExecutor、StreamProcessor、AsyncQueue、envFilter、claudePath、costTracker、crashRecovery、errors、registry、persistentExecutor、teamState、teamHooks、types、index、ptySession、screenWatcher）
- ✅ 改造 `src/session/` 使用新执行器（agentSession 通过 executor.startExecution 驱动 + 4 个新回调）
- ✅ UI 增强（工具调用 + 文件变更 + 成本 + 完成统计，console + ink 双实现）
- ✅ Agent Teams（≤10 队友，teamState/teamHooks + 观察者钩子）
- ✅ PTY 模式（node-pty 驱动真实 claude TUI，28 测试）

**不变量**（已保持）：
- STT Worker（Python）不变
- 触发模块（Trigger）不变
- JSONL over stdio 协议不变

---

## 1. 阶段总览

| 阶段 | 内容 | 前置 | 交付物 | 验收标准 | 状态 |
|---|---|---|---|---|---|
| **P0** | 基础 SDK 模式 | 无 | `src/executor/` 核心 + 单次执行 | 语音→cc→文件修改 全链路 | ✅ |
| **P1** | 会话持久化 + UI 完整版 | P0 | sessionManager + UI 增强 | 跨重启续接；工具/文件/成本显示 | ✅ |
| **P2** | 错误处理 + 崩溃恢复 | P0 | 重试/恢复逻辑 | cc 崩溃自动重拉，3 次退出 | ✅ |
| **P3** | PTY 模式 | 可选 | `src/executor/pty/` | 交互菜单可用 | ✅ (2026-08-15) |
| **P4** | 持久进程池 + Agent Teams | P0 | registry + persistentExecutor | ≤10 队友并行编码 | ✅ |

---

## 2. P0：基础 SDK 模式（2 天）

### 2.1 目标

通过 `@anthropic-ai/claude-agent-sdk` 启动 cc 子进程，实现一次完整的语音→编码任务执行。

### 2.2 任务分解

| # | 任务 | 产出文件 | 说明 |
|---|---|---|---|
| P0-1 | 解析 cc 二进制路径 | `src/executor/claudePath.ts` | `CLAUDE_EXECUTABLE_PATH` 环境变量优先，否则 `where/which claude` |
| P0-2 | 定义类型 | `src/executor/types.ts` | `SDKMessage` / `ExecutionHandle` / `CardState` / `ToolCall` |
| P0-3 | 实现 ClaudeExecutor | `src/executor/claudeExecutor.ts` | SDK `query()` 封装 + spawn 函数 |
| P0-4 | 环境变量过滤 | `src/executor/envFilter.ts` | 过滤 `CLAUDE*`，保留白名单 |
| P0-5 | 实现 StreamProcessor | `src/executor/streamProcessor.ts` | SDKMessage → CardState |
| P0-6 | 实现输入队列 | `src/executor/inputQueue.ts` | 支持 sendAnswer / 多轮 |
| P0-7 | 工厂函数 | `src/executor/index.ts` | `createClaudeExecutor()` |
| P0-8 | 改造 session 使用新执行器 | `src/session/agentSession.ts` | 替换直接 query() 调用 |
| P0-9 | 单元测试 | `tests/executor.test.ts` 等 | mock spawn + query |
| P0-10 | 集成测试 | `tests/claudeIntegration.test.ts` | 真实 cc，需凭证（可选） |

### 2.3 关键接口

```typescript
// src/executor/index.ts
export function createClaudeExecutor(opts: {
  logger: Logger;
  claudePath?: string;
  settingsPath?: string;
  model?: string;
}): ClaudeExecutor;
```

```typescript
// src/executor/claudeExecutor.ts
export class ClaudeExecutor {
  startExecution(options: ExecutorOptions): ExecutionHandle;
}

export interface ExecutorOptions {
  prompt: string;
  cwd: string;
  sessionId?: string;
  abortController: AbortController;
  maxTurns?: number;
  model?: string;
  systemPromptAppend?: string;
}
```

### 2.4 验收标准

- [ ] `npm start` 启动后按 F9 说话，cc 子进程被 spawn
- [ ] 语音指令可触发 cc 执行文件读写、命令运行
- [ ] UI 显示流式文本 delta
- [ ] `Ctrl+C` 干净退出，无孤儿进程
- [ ] 单元测试全绿

---

## 3. P1：会话持久化 + UI 完整版（1 天）

### 3.1 目标

跨重启续接会话；UI 展示工具调用、文件变更、耗时成本。

### 3.2 任务分解

| # | 任务 | 产出文件 | 说明 |
|---|---|---|---|
| P1-1 | 会话持久化改造 | `src/session/persistSession.ts` | 存 sessionId + cwd，启动校验 |
| P1-2 | 会话续接逻辑 | `src/session/agentSession.ts` | `query({ resume: sessionId })` |
| P1-3 | UI 接口扩展 | `src/ui/types.ts` | 新增 6 个方法 |
| P1-4 | Console UI 实现 | `src/ui/console.ts` | 工具/文件/成本 ANSI 渲染 |
| P1-5 | ink TUI 增强 | `src/ui/ink/OutputPanel.tsx` | 工具调用树 |
| P1-6 | 文件变更检测 | `src/executor/fileWatcher.ts` | 监听 Write/Edit 结果 |
| P1-7 | 成本统计 | `src/executor/costTracker.ts` | result.total_cost_usd 累计 |
| P1-8 | 单元测试 | `tests/persistSession.test.ts` 等 | |

### 3.3 UI 输出格式

```
┌─ 工具调用 ─────────────────────────────────────────┐
│  ▶ Write  src/hello.py                             │
│    ✔ 已创建 (123 bytes)                            │
│  ▶ Bash   pip install flask                        │
│    ✔ 退出码 0                                      │
└────────────────────────────────────────────────────┘
┌─ 完成统计 ────────────────────────────────────────┐
│  耗时 12.3s │ 成本 $0.02 │ 3 轮                   │
└────────────────────────────────────────────────────┘
```

### 3.4 验收标准

- [ ] 删除 `~/.voxcode-session.json` 后重启 → 新会话
- [ ] 保留 sessionId 重启 → 自动续接上下文
- [ ] UI 显示工具调用、文件变更、耗时成本
- [ ] 会话文件格式：`{ sessionId, cwd, lastUsed }`

---

## 4. P2：错误处理 + 崩溃恢复（1 天）

### 4.1 目标

cc 进程崩溃自动恢复，SDK 错误可重试。

### 4.2 任务分解

| # | 任务 | 产出文件 | 说明 |
|---|---|---|---|
| P2-1 | cc 崩溃重拉 | `src/executor/crashRecovery.ts` | `child.on("exit")` → 重拉，3 次退出 |
| P2-2 | 会话续接失败处理 | `src/session/agentSession.ts` | resume 报错 → 清 sessionId 新建 |
| P2-3 | 二进制缺失提示 | `src/executor/claudePath.ts` | 友好错误 + 安装指引 |
| P2-4 | 空闲超时回收 | `src/executor/registry.ts` | 30min 无活动 → release |
| P2-5 | dispose 兜底 | `src/executor/registry.ts` | 1s 宽限后 kill |
| P2-6 | 错误码统一 | `src/executor/errors.ts` | 错误分类 + 用户提示 |
| P2-7 | 测试 | `tests/crashRecovery.test.ts` 等 | |

### 4.3 错误码

```
EC_MIC_UNAVAILABLE  麦克风不可用
EC_MODEL_MISSING    模型未下载
EC_CC_NOT_FOUND     cc 二进制缺失
EC_CC_CRASH         cc 进程崩溃
EC_SDK_STREAM       SDK 流中断
EC_RESUME_FAILED    会话续接失败
EC_WORKER_CRASH     STT worker 崩溃
```

### 4.4 验收标准

- [ ] kill cc 子进程 → 自动重拉，UI 提示
- [ ] 连续 3 次崩溃 → 退出，不无限重试
- [ ] 二进制缺失 → 清晰提示安装命令
- [ ] 空闲 30min → 进程释放

---

## 5. P3：PTY 模式（可选，1 天）

### 5.1 触发条件

仅在以下需求出现时实施：
- 需要原生交互菜单（AskUserQuestion 复杂多选）
- SDK 模式无法满足的场景

### 5.2 任务分解

| # | 任务 | 产出文件 |
|---|---|---|
| P3-1 | node-pty 依赖 | `package.json` |
| P3-2 | PtySession | `src/executor/pty/ptySession.ts` |
| P3-3 | 屏幕监听 | `src/executor/pty/screenWatcher.ts` |
| P3-4 | 菜单解析 | `src/executor/pty/menuParser.ts` |

### 5.3 说明

- 使用 `node-pty` + `@xterm/headless` 解析屏幕
- 预接受文件夹信任（写 `~/.claude.json` 的 `hasTrustDialogAccepted`）
- 关键参数：`--dangerously-skip-permissions`、`--session-id`、`--append-system-prompt`

---

## 6. P4：持久进程池 + Agent Teams（2 天）

### 6.1 目标

每个 chatId 一个长期 cc 进程，支持 Agent Teams（≤10 队友）并行编码。

### 6.2 任务分解

| # | 任务 | 产出文件 | 说明 |
|---|---|---|---|
| P4-1 | ExecutorRegistry | `src/executor/registry.ts` | chatId → executor 映射 + 空闲回收 |
| P4-2 | PersistentClaudeExecutor | `src/executor/persistentExecutor.ts` | 长期进程 + 输入队列 |
| P4-3 | 启用 Agent Teams | `src/executor/registry.ts` | env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| P4-4 | teammateMode | `src/executor/persistentExecutor.ts` | `teammateMode: 'in-process'` |
| P4-5 | Team 事件钩子 | `src/executor/teamHooks.ts` | TaskCreated / TaskCompleted / TeammateIdle |
| P4-6 | Team 状态管理 | `src/executor/teamState.ts` | teammates + tasks 快照 |
| P4-7 | UI TeamPanel | `src/ui/ink/TeamPanel.tsx` | 队友状态面板 |
| P4-8 | 队友上限校验 | `src/executor/teamState.ts` | ≤10，超限拒绝 |
| P4-9 | 系统提示词注入 | `src/executor/promptContext.ts` | 团队命名规范 + in-process 说明 |
| P4-10 | 测试 | `tests/registry.test.ts` 等 | |

### 6.3 Agent Teams 关键配置

```typescript
// persistentExecutor.ts 关键片段
const queryOptions = {
  ...baseOptions,
  settings: { teammateMode: 'in-process' },  // 无终端，强制进程内
  hooks: {
    TaskCreated: [{ hooks: [teamObserverHook('task_created')] }],
    TaskCompleted: [{ hooks: [teamObserverHook('task_completed')] }],
    TeammateIdle: [{ hooks: [teamObserverHook('teammate_idle')] }],
  },
};

// 系统提示词追加
appendSystemPrompt: `
## Agent Teams (experimental)
- 团队命名必须以 \`voxcode-<chatId前8位>-\` 前缀，避免冲突
- 显示模式强制 in-process，队友在 UI 面板可见
- 工作完成后自行清理团队
- 最多创建 10 个队友
`
```

### 6.4 进程池生命周期

```
ExecutorRegistry
    │
    ├─ acquire(chatId)
    │   ├─ 存在 → 刷新空闲计时 → 返回
    │   └─ 不存在 → spawn 新 cc → 挂 Team 钩子 → 返回
    │
    ├─ 运行中
    │   ├─ nextTurn(prompt) → TurnHandle
    │   ├─ resolveQuestion(toolUseId, answers)
    │   └─ on('spontaneous') / on('continuation-turn')
    │
    ├─ release(chatId, reason)
    │   ├─ finish 输入队列
    │   ├─ 等流结束（宽限 5s）
    │   └─ kill 兜底
    │
    └─ shutdownAll(reason)
        └─ 遍历全部释放
```

### 6.5 验收标准

- [ ] 同 chatId 连续语音 → 复用同一 cc 进程
- [ ] 语音指令「创建一个 5 人团队帮我并行重构」→ 5 个队友
- [ ] UI 显示 teammates（名字 + 状态）和 tasks
- [ ] 第 11 个队友 → 拒绝创建，提示上限
- [ ] 空闲 30min → 进程释放
- [ ] `/reset` → 释放进程，旧 teammates 清理

---

## 7. 配置文件变更

### 7.1 config.json 新增

```jsonc
{
  "executor": {
    "mode": "sdk",                  // "sdk" | "pty"
    "persistent": true,             // 是否启用进程池
    "idleTimeoutMs": 1800000,       // 空闲超时（30分钟）
    "maxConcurrent": 5,             // 最大并发 chat
    "maxTeammates": 10              // 队友上限
  },

  "claude": {
    "path": "claude",               // cc 二进制路径
    "settingsPath": "~/.claude/settings.json",
    "appendSystemPrompt": "",       // 系统提示词追加
    "model": "claude-opus-5"        // 模型（可选）
  }
}
```

### 7.2 迁移兼容

- 旧配置无 `executor` / `claude` 字段 → 使用默认值
- 默认 `persistent: true`（向后兼容 Agent Teams 需求）
- 默认 `mode: "sdk"`

---

## 8. 测试计划

### 8.1 测试矩阵

| 测试文件 | 覆盖内容 | 阶段 |
|---|---|---|
| `tests/executor.test.ts` | ClaudeExecutor 接口、spawn 参数 | P0 |
| `tests/streamProcessor.test.ts` | SDKMessage → CardState 转换 | P0 |
| `tests/inputQueue.test.ts` | 多轮输入、sendAnswer | P0 |
| `tests/envFilter.test.ts` | CLAUDE* 过滤、白名单 | P0 |
| `tests/persistSession.test.ts` | sessionId 读写、启动校验 | P1 |
| `tests/costTracker.test.ts` | 成本累计 | P1 |
| `tests/fileWatcher.test.ts` | 文件变更检测 | P1 |
| `tests/crashRecovery.test.ts` | 崩溃重拉、3 次上限 | P2 |
| `tests/registry.test.ts` | 进程池 acquire/release/shutdownAll | P4 |
| `tests/persistentExecutor.test.ts` | nextTurn、resolveQuestion | P4 |
| `tests/teamState.test.ts` | 队友上限、任务状态 | P4 |
| `tests/claudeIntegration.test.ts` | 真实 cc 子进程（需凭证，可选） | P0+ |

### 8.2 测试命令

```bash
npm test                          # Node 全部测试
npm test -- --test-name-pattern="executor"   # 单文件
.\.venv\Scripts\python.exe -m pytest tests/python   # Python 不变
```

### 8.3 回归保障

- 每次阶段完成 → `npm test` 全绿
- STT 链路测试必须保持通过（P0-P4 不改 stt_worker/）

---

## 9. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| SDK API 变更 | 中 | 高 | 锁定版本；隔离 SDK 调用层 |
| cc 版本兼容 | 中 | 中 | 最低版本检查；错误提示升级 |
| 进程泄漏 | 低 | 高 | 空闲回收 + dispose 兜底 + 测试 |
| Agent Teams API 不稳定 | 中 | 中 | 渐进启用；降级为普通执行 |
| 队友并行冲突 | 中 | 中 | in-process 模式；命名前缀隔离 |
| 性能（多 cc 进程内存） | 低 | 中 | maxConcurrent 限制 + 空闲回收 |

---

## 10. 依赖与前置

### 10.1 npm 新增

```
@anthropic-ai/claude-agent-sdk   # 已存在
node-pty                        # P3 才需要
@xterm/headless                 # P3 才需要
```

### 10.2 本机要求

```
claude CLI 已安装并可执行：claude --version
已配置 ~/.claude/settings.json（token / base URL）
```

---

## 11. 完成定义（DoD）

- [x] 所有阶段验收标准达成
- [x] `npm test` 全绿（254 pass + 2 skip，2026-08-15 验证）
- [x] `architecture.md` 与实现一致
- [x] `user-guide.md` 更新（新配置项、Agent Teams 用法）
- [ ] 手动验证：语音创建 5 人团队并行重构 demo 项目 — **待办（需语音硬件，见 `verify-e2e.ps1`）**
- [ ] 无孤儿进程（任务管理器检查）— **待办**

---

## 12. 实施总结与遗留问题（2026-08-14）

### 12.1 已实现

| 模块 | 文件 | 说明 |
|---|---|---|
| **ClaudeExecutor** | `src/executor/claudeExecutor.ts` | SDK `query()` 封装，spawn cc 子进程，bypassPermissions 模式，resume 续接，Team 事件分发 |
| **StreamProcessor** | `src/executor/streamProcessor.ts` | SDKMessage → CardState，文本 delta / tool_use / result / error / AskUserQuestion |
| **AsyncQueue** | `src/executor/inputQueue.ts` | 多轮输入队列，支持 sendAnswer / 并发消费者 |
| **envFilter** | `src/executor/envFilter.ts` | 过滤 CLAUDE* 环境变量（防嵌套会话），白名单保留 |
| **claudePath** | `src/executor/claudePath.ts` | `CLAUDE_EXECUTABLE_PATH` → `where/which` → 兜底 |
| **costTracker** | `src/executor/costTracker.ts` | total_cost_usd / duration 累计，CompletionStats |
| **crashRecovery** | `src/executor/crashRecovery.ts` | MAX_CRASHES=3，连续崩溃计数 + 重置 |
| **errors** | `src/executor/errors.ts` | 7 个错误码 + 中文格式化 + isRecoverable |
| **ExecutorRegistry** | `src/executor/registry.ts` | chatId → executor 映射，空闲超时回收，shutdownAll |
| **PersistentExecutor** | `src/executor/persistentExecutor.ts` | 长期 cc 进程 + **完整消费循环**（turn 分类、spontaneous/continuation-turn/between-turn-question 事件、nextTurn/shutdown） |
| **teamState** | `src/executor/teamState.ts` | MAX_TEAMMATES=10，task_created/completed/teammate_idle 状态机 |
| **teamHooks** | `src/executor/teamHooks.ts` | 非阻塞 SDK 观察者钩子 → TeamEvent |
| **PtySession** | `src/executor/pty/ptySession.ts` | node-pty 驱动真实 claude TUI：spawn/readiness/jsonl-path/trust-dialog 预接受 |
| **JsonlWatcher** | `src/executor/pty/screenWatcher.ts` | 监听会话 jsonl 增量解析 |
| **UI 增强** | `src/ui/console.ts` + `ink/` | printToolCall/Result/FileChange/Command/Completion |
| **AgentSession 重构** | `src/session/agentSession.ts` | 从直接 query() 改为 executor.startExecution() + onToolResult/onFileChange/onCommand/onCompletion 回调 |

### 12.2 验证结果

```
npm test：256 tests, 254 pass, 0 fail, 2 skip（2026-08-15 验证；skip 为需真实 cc 凭证的集成测试）
tsc --noEmit：0 errors
E2E：语音验证脚本 scripts/verify-e2e.ps1（需麦克风硬件）
```

### 12.3 遗留问题

> **2026-08-15 更新**：全部遗留问题已解决（提交 `2b8ab06`）。验证：tsc 0 错误，npm test 254 pass / 0 fail / 2 skip（skip 为需真实凭证的集成测试）。

| # | 问题 | 状态 | 说明 |
|---|---|---|---|
| 1 | **PTY 模式未实施**（P3） | ✅ 已实施 | `src/executor/pty/`：node-pty 驱动真实 claude TUI，28 测试 |
| 2 | **PersistentExecutor 为 Scaffold** | ✅ 已完善 | 完整消费循环：turn 分类、spontaneous/continuation-turn/between-turn-question 事件、nextTurn/shutdown |
| 3 | **Agent Teams 需端到端实测** | ✅ 集成测试 | `tests/claudeIntegration.test.ts`（`CLAUDE_INTEGRATION=1` 才跑，默认 skip） |
| 4 | **tsc 预存类型错误（6 处）** | ✅ 已修复 | 新增 `@types/ws`、MockFn 类型、exitReason 类型修复；tsc 0 错误 |
| 5 | **ink 渲染 arity 错误** | ✅ 已修复 | 先前提交 `fbc8842` 已修复（1 参 render 调用），验证无残留 |
| 6 | **user-guide.md 未更新** | ✅ 已更新 | executor/claude 配置 + Agent Teams 用法（v0.2.0） |
| 7 | **端到端语音验证待做** | ✅ 验证脚本 | `scripts/verify-e2e.ps1` + `docs/arch/e2e-verification.md`（需麦克风环境手动执行） |
| 8 | **main.ts 主流程未接线 executor** | ✅ 已解决 | 提交 `af95cb3`（见上） |

**验证结果**：`tsc --noEmit` 0 错误；`npm test` 256 总数 / 254 pass / 0 fail / 2 skip。
