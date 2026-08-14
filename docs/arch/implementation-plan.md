# voxcode 架构实施计划

- **日期**：2026-08-14
- **目标版本**：0.2.0
- **关联文档**：`architecture-v2-design.md`（设计）、`architecture.md`（架构）
- **状态**：待实施

---

## 0. 计划摘要

将 voxcode 从「直接调用 AI API」重构为「通过 claude-agent-sdk 启动并控制本地 Claude Code 实例」，获得完整 coding 能力（读写文件、运行命令、调试、Agent Teams）。

**范围**：
- ✅ 新增 `src/executor/`（CC 执行器 + 进程池）
- ✅ 改造 `src/session/` 使用新执行器
- ✅ UI 增强（工具调用 + 文件变更 + 成本 + 队友面板）
- ✅ Agent Teams（≤10 队友）
- ⏸ PTY 模式（可选，按需）

**不变量**：
- STT Worker（Python）不变
- 触发模块（Trigger）不变
- JSONL over stdio 协议不变

---

## 1. 阶段总览

| 阶段 | 内容 | 前置 | 交付物 | 验收标准 |
|---|---|---|---|---|
| **P0** | 基础 SDK 模式 | 无 | `src/executor/` 核心 + 单次执行 | 语音→cc→文件修改 全链路 |
| **P1** | 会话持久化 + UI 完整版 | P0 | sessionManager + UI 增强 | 跨重启续接；工具/文件/成本显示 |
| **P2** | 错误处理 + 崩溃恢复 | P0 | 重试/恢复逻辑 | cc 崩溃自动重拉，3 次退出 |
| **P3** | PTY 模式 | 可选 | `src/executor/pty/` | 交互菜单可用 |
| **P4** | 持久进程池 + Agent Teams | P0 | registry + persistentExecutor | ≤10 队友并行编码 |

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

- [ ] 所有阶段验收标准达成
- [ ] `npm test` 全绿（新增 + 回归）
- [ ] `architecture.md` 与实现一致
- [ ] `user-guide.md` 更新（新配置项、Agent Teams 用法）
- [ ] 手动验证：语音创建 5 人团队并行重构 demo 项目
- [ ] 无孤儿进程（任务管理器检查）
