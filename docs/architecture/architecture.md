# VoxBridge 架构文档

- **日期**�?026-08-14
- **版本**�?.2.0
- **状�?*：✅ 已实施（P0–P4 全部完成�?54 测试通过 + 2 跳过；详�?`implementation-plan.md` §12�?

---

## 目录

1. [架构演进动机](#1-架构演进动机)
2. [架构总览](#2-架构总览)
3. [进程拓扑](#3-进程拓扑)
4. [通信协议](#4-通信协议)
5. [数据流](#5-数据�?
6. [部署依赖](#6-部署依赖)
7. [模块详解](#7-模块详解)
8. [核心接口设计](#8-核心接口设计)
9. [配置扩展](#9-配置扩展)
10. [错误处理](#10-错误处理)
11. [测试策略](#11-测试策略)
12. [目录结构](#12-目录结构)
13. [设计决策记录](#13-设计决策记录)
14. [实施计划](#14-实施计划)
15. [风险与缓解](#15-风险与缓�?
16. [附录 A：MetaBot 参考架构](#16-附录-ametabot-参考架�?
17. [附录 B：类型定义完整版](#17-附录-b类型定义完整�?

---

## 1. 架构演进动机

### 1.1 原始问题

旧版 VoxBridge 直接调用 AI API，没有利�?Claude Code 的完整能力：

```
旧架构：
┌─────────────────────────────────────────────────────────────�?
�? VoxBridge (语音助手)                                           �?
�?                                                             �?
�? ┌──────────────�?   ┌────────────────────────────────�?   �?
�? �?语音识别      │───→│ Agent SDK query()               �?   �?
�? �?(Whisper)    �?   �?直接调用 AI API                   �?   �?
�? └──────────────�?   └────────────────────────────────�?   �?
�?                              �?                             �?
�?                              �?                             �?
�?                   ┌─────────────────────�?                 �?
�?                   �? AI API (云端)       �?                 �?
�?                   └─────────────────────�?                 �?
└─────────────────────────────────────────────────────────────�?

问题�?
- 只能做简单的问答
- 无法执行 coding 任务（读写文件、运行命令、调试）
- 失去�?Claude Code 的工具链能力
```

### 1.2 目标架构

**VoxBridge 作为语音控制器，启动并控制本�?Claude Code 实例执行 coding 任务**�?

```
目标架构�?
┌─────────────────────────────────────────────────────────────�?
�? VoxBridge (语音控制�?                                         �?
�?                                                             �?
�? ┌──────────────�?   ┌────────────────────────────────�?   �?
�? �?语音识别      │───→│ Claude Code Executor            �?   �?
�? �?(Whisper)    �?   �?spawn('claude', [...])          �?   �?
�? └──────────────�?   └────────────────────────────────�?   �?
�?                              �?                             �?
�?                              �?                             �?
�?                   ┌─────────────────────�?                 �?
�?                   �?Claude Code 实例     �?�?完整�?cc 能力 �?
�?                   �?- 读写文件 / 运行命令 / 调试代码 / 工具链│
�?                   └─────────────────────�?                 �?
�?                              �?                             �?
�?                              �?                             �?
�?                   ┌─────────────────────�?                 �?
�?                   �? AI API (云端)       �?                 �?
�?                   └─────────────────────�?                 �?
└─────────────────────────────────────────────────────────────�?
```

---

## 2. 架构总览

VoxBridge 采用**多进程架�?*：Node.js 主进程作为语音控制器，通过 claude-agent-sdk 启动并控制本�?Claude Code 实例执行 coding 任务；Python 子进程负责语音采集和识别�?

```
┌─────────────────────────────────────────────────────────────────────────�?
�? 用户终端 (Windows Terminal / PowerShell)                                 �?
�?                                                                         �?
�? ┌─────────────────────────────────────────────────────────────────────┐│
�? �? VoxBridge (Node.js 主进�?                                            ││
�? �?                                                                     ││
�? �? ┌──────────────�? ┌─────────────────�? ┌───────────────────────�? ││
�? �? �?Trigger       �? �?CC Executor      �? �?Terminal UI            �? ││
�? �? �?             │→ �?                │→ �?(ANSI console / ink)   �? ││
�? �? �?F9/Esc/      �? �?spawn claude    �? �?                      �? ││
�? �? �?WakeWord     �? �?process         �? �?状�?识别/回复/进度     �? ││
�? �? └──────────────�? └────────┬────────�? └───────────────────────�? ││
�? �?                            �?                                       ││
�? �? ┌──────────────────────────┼────────────────────────────────────�?││
�? �? �?                         �?                                     �?││
�? �? �? ┌─────────────────────────────────────────────────────────�?  �?││
�? �? �? �? Claude Code 实例 (子进�?                                �?  �?││
�? �? �? �?                                                         �?  �?││
�? �? �? �? 能力�?                                                  �?  �?││
�? �? �? �? ├─ 读写文件 (Write/Edit/Read)                           �?  �?││
�? �? �? �? ├─ 运行命令 (Bash)                                       �?  �?││
�? �? �? �? ├─ 代码搜索 (Grep/Glob)                                  �?  �?││
�? �? �? �? ├─ Git 操作                                              �?  �?││
�? �? �? �? ├─ Agent Teams（最�?10 队友�?                          �?  �?││
�? �? �? �? └─ 工具�?                                               �?  �?││
�? �? �? �?                                                         �?  �?││
�? �? �? �? 通信�?                                                  �?  �?││
�? �? �? �? ├─ JSONL stream (SDK)                                   �?  �?││
�? �? �? �? └─ ~/.claude/projects/<cwd>/<session>.jsonl             �?  �?││
�? �? �? └──────────────────────────────────────────────────────────�?  �?││
�? �? └──────────────────────────────────────────────────────────────────�?││
�? └─────────────────────────────────────────────────────────────────────┘│
�?                                                                         �?
�? ┌─────────────────────────────────────────────────────────────────────┐│
�? �? Python STT Worker (子进�?                                          ││
�? �?                                                                     ││
�? �? ┌─────────�? ┌──────�? ┌─────────────────────────────�?           ││
�? �? �?Recorder │→�?VAD  │→�?WhisperEngine                �?           ││
�? �? �?sound-   �? │能�? �? �?faster-whisper large-v3     �?           ││
�? �? �?device   �? │silero�? �?(3GB, CPU, int8)           �?           ││
�? �? └─────────�? └──────�? └─────────────────────────────�?           ││
�? └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────�?
                             �?
                             �?HTTPS (Anthropic API 兼容)
                             �?
                  ┌─────────────────────�?
                  �? AI API 网关          �?
                  �? DeepSeek / Anthropic �?
                  └─────────────────────�?
```

---

## 3. 进程拓扑

### 3.1 Node.js 主进�?

| 模块 | 文件 | 职责 |
|---|---|---|
| **入口** | `src/main.ts` | 装配所有模块，生命周期管理 |
| **配置** | `src/config.ts` | 加载 config.json，合并默认�?|
| **环境变量** | `src/env.ts` | 读取 ~/.claude + .claude �?env �?|
| **触发模块** | `src/trigger/` | F9 热键 / 终端切换 / 唤醒�?|
| **STT 客户�?* | `src/stt/` | 管理 Python worker 子进�?|
| **CC 执行�?* | `src/executor/` | 启动/控制 Claude Code 进程 |
| **会话管理** | `src/session/` | 会话持久化、续�?|
| **终端 UI** | `src/ui/` | ANSI console / ink TUI |

### 3.2 Claude Code 实例（子进程�?

| 方面 | 说明 |
|---|---|
| **二进�?* | 本机 `claude`（`where claude` / `which claude` 解析�?|
| **启动参数** | `--session-id` / `--resume` / `--dangerously-skip-permissions` / `--settings` / `--model` |
| **通信** | SDK `query()` 返回 JSONL �?|
| **会话文件** | `~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl` |
| **生命周期** | �?ExecutorRegistry 管理，空闲超时回�?|

**路径规则�?*
- `escaped-cwd`：工作目录路径，`/` 替换�?`-`
- 示例：`D:\Codes\VoxBridge` �?`D--Codes-VoxBridge`

### 3.3 Python STT Worker

| 模块 | 文件 | 职责 |
|---|---|---|
| **入口** | `stt_worker/main.py` | stdio JSONL 协议循环 |
| **录音** | `stt_worker/recorder.py` | sounddevice 采集 PCM |
| **端点检�?* | `stt_worker/vad.py` | silero-vad / 能量阈�?fallback |
| **识别引擎** | `stt_worker/whisper_engine.py` | faster-whisper 封装 |
| **设备检�?* | `stt_worker/device.py` | 启动时检查麦克风可用�?|
| **模型下载** | `stt_worker/model_download.py` | 自动下载缺失模型 |
| **唤醒�?* | `stt_worker/wakeword.py` | 唤醒词匹�?|
| **协议** | `stt_worker/protocol.py` | JSONL 编解�?|

---

## 4. 通信协议

### 4.1 Node �?Python（语音链路）

- **通道**：stdio（标准输�?输出管道�?
- **格式**：JSONL（每行一�?JSON 对象�?
- **编码**：UTF-8

```
Node �?Python（命令）�?
  {"type": "start"}        开始录�?
  {"type": "stop"}         停止录音，请求识别结�?
  {"type": "quit"}         退�?worker

Python �?Node（事件）�?
  {"type": "ready"}        worker 初始化完�?
  {"type": "recording"}    录音已开�?
  {"type": "result",       识别成功
   "text": "...",
   "duration_ms": 1234}
  {"type": "noise"}        无有效语音（静音/噪声�?
  {"type": "downloading",  模型下载进度
   "progress": 0.5,
   "message": "下载�?50%"}
  {"type": "wake"}         检测到唤醒词（预留�?
  {"type": "error",        错误
   "message": "..."}
```

### 4.2 Node �?Claude Code（编码链路）

- **通道**：SDK `query()` 异步�?+ 子进�?stdin/stdout
- **格式**：SDKMessage（JSONL 结构化消息）

```
Node �?CC（用户消息）�?
  { "type": "user", "message": { "role": "user", "content": "..." } }

CC �?Node（流式事件）�?
  { "type": "stream_event", "event": { "type": "content_block_delta", "delta": { "text": "..." } } }
  { "type": "tool_use", "message": { "content": [{ "type": "tool_use", "name": "Bash", "input": {...} }] } }
  { "type": "result", "result": "...", "duration_ms": 1234, "total_cost_usd": 0.01 }
```

### 4.3 时序

```
启动�?
  Node                          Python                        CC
   �?                             �?                           �?
   │── spawn worker ────────────�?�?                           �?
   �?                             ├── 检查麦克风               �?
   �?                             ├── 检�?下载模型            �?
   �?                             ├── 加载 Whisper (3GB)      �?
   │←── {"type":"ready"} ──────── �?                           �?
   �?                             �?                           �?
   │── spawn claude ─────────────────────────────────────────�?�?
   �?                             �?                           �?
   │←── SDK stream ready ───────────────────────────────────── �?

语音指令�?
   │── {"type":"start"} ────────�?�?                           �?
   │←── {"type":"recording"} ──── �?                           �?
   �?                             ├── 录音中�?                 �?
   │── {"type":"stop"} ─────────�?�?                           �?
   �?                             ├── VAD 检�?                �?
   �?                             ├── Whisper 转写             �?
   │←── {"type":"result",...} ─── �?                           �?
   �?                             �?                           �?
   │── query({ prompt }) ─────────────────────────────────────→│
   �?                             �?                           �?
   │←── stream_event: text_delta ───────────────────────────── �?
   │←── tool_use: Write ────────────────────────────────────── �?
   │←── stream_event: tool_result ──────────────────────────── �?
   │←── result (complete) ──────────────────────────────────── �?

退出：
   │── {"type":"quit"} ─────────�?�?                           �?
   �?                             └── exit(0)                  �?
   │── finish() + abort ─────────────────────────────────────�?�?
   �?                             �?                           �?
   �?                             └── exit(0)                  �?
```

---

## 5. 数据�?

### 5.1 一次完整的语音指令

```
时间�?─────────────────────────────────────────────────────────────�?

[按住F9]  [说话]  [松开F9]   [VAD]   [Whisper]  [CC Executor]  [完成]
   �?        �?       �?        �?       �?         �?           �?
   �?        �?       �?        �?       �?         �?           �?
  start ────────�?stop ──�?有声? ──�?转写 ──�?query() ──�?就绪
  cmd            cmd    �?     (3-6s)     �?   spawn cc     状�?
                       �?                 �?  + 流式事件
                  noise→丢�?       ┌──────┴──────�?
                       编辑确认   text_delta    tool_use
                       (Enter)   打印(流式)    �?Write
                           �?                 �?Bash
                       发送给 CC        ┌──────┴──────�?
                                 tool_result   result
                                 �?变更摘要    耗时/成本
```

### 5.2 会话生命周期

```
启动 VoxBridge
    �?
    ├─ loadSessionId() �?~/.voxbridge-session.json
    �?
    ├─ 用户语音输入
    �?
    └─ runOneTurn()
        ├─ 持久模式 �?ExecutorRegistry.acquire(chatId)
        �?  ├─ 已有进程 �?复用（刷新空闲计时器�?
        �?  └─ 新建进程 �?spawn claude + 输入队列
        ├─ 单次模式 �?ClaudeExecutor.startExecution()
        �?
        ├─ 流式消费 �?StreamProcessor �?UI
        ├─ 完成�?�?保存 sessionId
        �?
        └─ 空闲超时 �?ExecutorRegistry.release(chatId)
```

### 5.3 会话状态文�?

```json
// ~/.voxbridge-session.json
{
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "updatedAt": "2026-08-15T21:00:00.000Z"
}
```

---

## 6. 部署依赖

### 6.1 本机必需

```
运行时：
  Node.js �?20 ──────── 主进�?+ Agent SDK
  Python 3.12 ───────── STT Worker
  Claude Code CLI ───── cc 二进制（npm install -g @anthropic-ai/claude-code 或官方安装）
  .venv/ ────────────── Python 虚拟环境
    ├── faster-whisper    语音识别引擎
    ├── sounddevice       麦克风采�?
    ├── numpy             音频数据处理
    ├── onnxruntime       silero-vad 推理（可选）
    └── huggingface_hub   模型下载

模型文件�?
  D:\Models\faster-whisper-large-v3\
    └── model.bin (3.08 GB)
  stt_worker/models/
    └── silero_vad.onnx (可�? ~2MB)

配置文件�?
  config.json ────────────────── 项目配置
  ~/.claude/settings.json ────── API 凭证 (token 不入�?
  ~/.voxbridge-session.json ────── 会话续接 ID

npm 依赖�?
  @anthropic-ai/claude-agent-sdk ── 启动/控制 cc 子进�?
  node-global-key-listener ──────── 全局热键 (原生模块)
  ws ────────────────────────────── Web Speech 桥接
  react + ink ───────────────────── ink TUI（可选）
  node-pty ──────────────────────── PTY 模式（P3，原�?prebuild�?
```

### 6.2 外部服务

```
AI API 网关（HTTPS）：
  DeepSeek:   https://api.deepseek.com/anthropic
  Anthropic:  https://api.anthropic.com

凭证来源（由 cc 子进程读取，VoxBridge 不接触）�?
  ~/.claude/settings.json �?env �?
    ANTHROPIC_AUTH_TOKEN
    ANTHROPIC_BASE_URL
    ANTHROPIC_MODEL

模型下载（首次）�?
  HuggingFace: Systran/faster-whisper-large-v3
  silero-vad:  github.com/snakers4/silero-vad
```

### 6.3 安全边界

```
敏感数据              处理方式
─────────────────────────────────────────────────
API Token            只存 ~/.claude/settings.json
                     cc 子进程直接读取，VoxBridge 不处�?
语音数据             仅存于内存，不落盘，不传�?
                     （本�?Whisper 推理�?
会话 ID              �?~/.voxbridge-session.json
                     仅包�?session UUID
代码/文件            cc �?cwd 内操�?
                     继承 Claude Code 权限模型
```

**安全考虑补充�?*

| 场景 | 处理方式 |
|---|---|
| 文件操作 | cc �?cwd 内操作，继承 Claude Code 权限 |
| 命令执行 | `bypassPermissions` 模式，语音确认即�?|
| API 调用 | cc 通过 HTTPS 直接�?API，token 不经 VoxBridge |

**敏感数据流：**
```
用户语音 �?Whisper（本地） �?文本
                                      �?
                               VoxBridge 主进�?
                                      �?
                          Claude Code 子进�?
                                      �?
                               HTTPS �?AI API
```

---

## 7. 模块详解

### 7.1 触发模块 (src/trigger/)

```
┌────────────────────────────────────────────────�?
�? createTrigger(config.trigger) �?Trigger        �?
�?                                                 �?
�? 优先级：                                         �?
�?   1. wakeWord.enabled �?createWakeWordTrigger() �?
�?   2. global=true     �?createGlobalTrigger()    �?
�?   3. global=false    �?createTerminalTrigger()   �?
�?                                                 �?
�? Trigger 接口�?                                  �?
�?   start(callbacks): void                        �?
�?   stop(): void                                  �?
�?                                                 �?
�? Callbacks:                                      �?
�?   onStartListening(): void  �?开始录�?          �?
�?   onStopListening(): void   �?结束录音           �?
�?   onCancel(): void          �?取消              �?
�?                                                 �?
�? 终端触发器细�?(createTerminalTrigger):          �?
�?   - F9 键序列支持：ESC[18~ �?ESC[20~           �?
�?     (Windows Terminal/PowerShell �?ESC[20~)    �?
�?   - 300ms 防抖：防止快速连续触�?                 �?
�?   - Esc 取消录音                                 �?
�?   - Ctrl+C 优雅退�?                             �?
└────────────────────────────────────────────────�?
```

### 7.2 STT 客户�?(src/stt/)

```
┌────────────────────────────────────────────────�?
�? createSttClient(config.stt, cwd, options)       �?
�?   �?WorkerSttClient (implements SttClient)      �?
�?                                                 �?
�? WorkerSttClient:                                �?
�?   spawnFor() ── spawn python 子进�?             �?
�?   start()    ── �?{"type":"start"}             �?
�?   stop()     ── �?{"type":"stop"} �?Promise    �?
�?   cancel()   ── 丢弃当前录音                     �?
�?   waitReady()── 等待 ready 事件                  �?
�?   dispose()  ── quit + 等退�?+ kill 兜底        �?
�?                                                 �?
�? 插件注册表：                                     �?
�?   createPlugin("whisper")    �?WorkerSttClient   �?
�?   createPlugin("webspeech")  �?WebSpeechPlugin   �?
└────────────────────────────────────────────────�?
```

### 7.3 CC 执行�?(src/executor/)

```
┌────────────────────────────────────────────────�?
�? ClaudeExecutor (单次模式)                       �?
�?   startExecution(opts) �?ExecutionHandle       �?
�?     ├─ SDK query() 流式消费                     �?
�?     ├─ 处理 tool_use / tool_result              �?
�?     └─ 返回流式事件给调用方（封�?spawn�?       �?
�?                                                 �?
�? ExecutorRegistry (持久模式)                     �?
�?   acquire(chatId) �?PersistentClaudeExecutor    �?
�?     ├─ �?chatId 一个长�?cc 进程               �?
�?     ├─ 空闲超时回收 (30min)                     �?
�?     └─ 支持 Agent Teams (�?0 队友)              �?
�?                                                 �?
�? PersistentClaudeExecutor                        �?
�?   nextTurn(prompt) �?TurnHandle                 �?
�?   resolveQuestion(toolUseId, answers)           �?
�?   runLoop() 消费循环�?                         �?
�?     ├─ 用户轮次结果 �?结束当前 turn             �?
�?     ├─ 轮外活动  �?emit('spontaneous')         �?
�?     ├─ task_notification �?emit('continuation-turn')
�?     └─ ask_user_question 轮外 �?emit('between-turn-question')
�?   shutdown()                                    �?
�?                                                 �?
�? StreamProcessor                                 �?
�?   processMessage(msg) �?CardState               �?
�?                                                 �?
�? PtySession (PTY 模式, P3 已实�?                �?
�?   spawn 真实 claude TUI (node-pty)              �?
�?   ready() / typePrompt() / interrupt() / screen()
�?   JsonlWatcher 读取 ~/.claude/projects/...jsonl �?
└────────────────────────────────────────────────�?
```

**辅助模块**（对等实现）�?

| 文件 | 职责 |
|---|---|
| `claudePath.ts` | 解析 cc 二进制路径（`CLAUDE_EXECUTABLE_PATH` �?`where/which` �?兜底�?|
| `envFilter.ts` | 过滤 `CLAUDE*` 环境变量（防嵌套会话），白名单保�?|
| `inputQueue.ts` | `AsyncQueue<T>` 多轮输入队列 |
| `costTracker.ts` | `total_cost_usd` / `duration_ms` 累计 �?`CompletionStats` |
| `crashRecovery.ts` | `MAX_CRASHES=3`，连续崩溃计�?+ 重置 |
| `errors.ts` | 7 个错误码 + 中文格式�?+ `isRecoverable` |
| `teamState.ts` | `MAX_TEAMMATES=10`，TaskCreated/Completed/Idle 状态机 |
| `teamHooks.ts` | 非阻�?SDK 观察者钩�?�?`TeamEvent` |
| `pty/` | PTY 模式（ptySession / screenWatcher / index�?|

**持久进程池关键设计：**

```typescript
// src/executor/registry.ts
class ExecutorRegistry {
  private executors = new Map<string, PersistentClaudeExecutor>();
  private idleTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  async acquire(chatId: string, options: AcquireOptions): Promise<PersistentClaudeExecutor> {
    // 已存�?�?刷新空闲计时器并返回
    // 不存�?�?创建新实例（spawn cc 进程 + 输入队列�?
  }

  async release(chatId: string, reason: string): Promise<void> {
    // 优雅关闭：finish 输入队列 �?等待流结�?�?kill 兜底
  }

  async shutdownAll(reason: string): Promise<void> {
    // 遍历所有实例释�?
  }
}
```

### 7.4 会话管理 (src/session/)

```
┌────────────────────────────────────────────────�?
�? createAgentSession(opts) �?AgentSession         �?
�?                                                 �?
�? AgentSession:                                   �?
�?   send(prompt) �?Promise<SendResult>            �?
�?     ├─ 调用 CC Executor                         �?
�?     ├─ 消费流式事件（text_delta / tool_use�?     �?
�?     ├─ 检测危险工�?�?onDangerousTool 回调       �?
�?     └─ 成功后保�?sessionId                     �?
�?                                                 �?
�?   reset() �?void                                �?
�?     └─ 清除 sessionId（内�?+ 持久化文件）        �?
�?                                                 �?
�? 持久化：                                         �?
�?   loadSessionId(file)  �?启动时读�?              �?
�?   saveSessionId(file, id) �?成功后写�?           �?
�?   clearSessionId(file) �?reset 时删�?           �?
�?                                                 �?
�? 环境继承�?                                       �?
�?   readSettingsEnv(cwd)                          �?
�?     �?合并 ~/.claude/settings.json              �?
�?            + .claude/settings.json �?env �?    �?
└────────────────────────────────────────────────�?
```

### 7.5 终端 UI (src/ui/)

```
┌────────────────────────────────────────────────�?
�? UI 接口 (src/ui/types.ts)                       �?
�?   printStatus(text): void                       �?
�?   printRecognition(text): void                  �?
�?   printAssistantDelta(text): void               �?
�?   printToolLine(text): void                     �?
�?   printToolCall(tool): void                     �?
�?   printToolResult(tool, result): void           �?
�?   printFileChange(file, action): void           �?
�?   printCommand(cmd, output?): void              �?
�?   printCompletion(stats): void                  �?
�?   printError(text): void                        �?
�?   printWarning(text): void                      �?
�?   clearStatusLine(): void                       �?
�?   printDownloadProgress(p, m): void             �?
�?   promptEditRecognition(text): Promise<string?>  �?
�?                                                 �?
�? 实现�?                                         �?
�?   createConsoleUI() �?ANSI 终端输出              �?
�?   createInkUI()     �?React/ink TUI（可选）      �?
�?                                                 �?
�? 工厂�?                                         �?
�?   createUI(config.ui.mode) �?UI                 �?
└────────────────────────────────────────────────�?
```

**说明**：`printTeamState`（队友面板）在设计中设想，但当前 UI 接口**未实�?*——Agent Teams 状态目前通过 Team 事件钩子（`teamHooks`）收集，UI 面板渲染预留待后续（�?§7.3）。实际接口含 `printToolLine`（工具行）。关键类型：

```typescript
// src/executor/types.ts
export interface ToolCallInfo {
  name: string;
  input?: unknown;          // 输入参数
}
export interface CompletionStats {
  durationMs: number;
  costUsd?: number;
  turns: number;
}
```

**UI 显示内容�?*

| 元素 | 显示时机 | 说明 |
|---|---|---|
| **工具调用** | tool_use 事件 | 显示 `�?Write`, `�?Bash` �?|
| **文件变更** | Write/Edit 完成 | 显示文件路径和变更摘�?|
| **命令输出** | Bash 完成 | 显示命令和关键输�?|
| **耗时/成本** | result 事件 | 显示耗时�?API 成本 |
| **队友状�?* | Team 事件 | 显示 teammates + tasks 面板 |

---

## 8. 核心接口设计

### 8.1 ClaudeExecutor

```typescript
// src/executor/types.ts
export interface ClaudeExecutorOptions {
  cwd: string;                    // 工作目录
  sessionId?: string;             // 会话 ID（续接）
  model?: string;                 // 模型选择
  systemPrompt?: string;          // 系统提示词追�?
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

### 8.2 核心实现

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

### 8.3 消息流处�?

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

### 8.4 UI 类型扩展

```typescript
// src/ui/types.ts（接口方法：printToolCall / printToolResult / printFileChange /
//       printCommand / printCompletion，类型从 executor 导入�?
export interface UI {
  // 现有接口
  printStatus(text: string): void;
  printRecognition(text: string): void;
  printAssistantDelta(text: string): void;
  printToolLine(text: string): void;

  // 新增接口
  printToolCall(tool: ToolCallInfo): void;
  printToolResult(tool: string, result: string): void;
  printFileChange(file: string, action: 'create' | 'modify' | 'delete'): void;
  printCommand(cmd: string, output?: string): void;
  printCompletion(stats: CompletionStats): void;
}

// src/executor/types.ts
export interface ToolCallInfo {
  name: string;
  input?: unknown;
}

export interface CompletionStats {
  durationMs: number;
  costUsd?: number;
  turns: number;
}
```

**Agent Teams 类型**（`src/executor/types.ts`，由 `teamState` / `teamHooks` 使用）：

```typescript
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

export type TeamEvent =
  | { kind: 'task_created'; taskId: string; subject: string; description?: string; teammate?: string; teamName?: string }
  | { kind: 'task_completed'; taskId: string; subject: string; teammate?: string; teamName?: string }
  | { kind: 'teammate_idle'; teammate: string; teamName: string };
```

---

## 9. 配置扩展

### 9.1 config.json 新增字段

```jsonc
{
  // ─── 执行器配置（新增）───
  "executor": {
    "mode": "sdk",                    // "sdk" | "pty"
    "persistent": true,               // 持久进程�?
    "idleTimeoutMs": 1800000,         // 空闲超时�?0分钟�?
    "maxConcurrent": 5,               // 最大并发数
    "maxTeammates": 10                // Agent Teams 队友上限
  },

  // ─── Claude Code 配置（新增）───
  "claude": {
    "path": "claude",                 // cc 二进制路�?
    "settingsPath": "~/.claude/settings.json",
    "appendSystemPrompt": "",         // 系统提示词追�?
    "model": "claude-opus-5"          // 模型选择
  },

  // ─── 现有配置保持不变 ───
  "stt": { ... },
  "trigger": { ... },
  "ui": { ... }
}
```

---

## 10. 错误处理

| 场景 | 检测点 | 处理方式 |
|---|---|---|
| 麦克风不可用 | worker 启动�?device.py | error 消息 �?Node 打印并退�?|
| 模型未下�?| worker 启动�?model_download.py | 自动下载 + JSONL 进度报告 |
| 识别为空/噪声 | worker VAD 检�?| 返回 noise，Node 不发送给 Agent |
| cc 二进制缺�?| resolveClaudePath() | 提示安装 `npm install -g @anthropic-ai/claude-code` |
| cc 进程崩溃 | child.on("exit") | 自动重拉起，3 次后退�?|
| SDK 流中�?| stream 迭代异常 | 显示错误，会话可重试 |
| 会话续接失败 | query resume 报错 | 清除�?sessionId，新建会�?|
| Worker 崩溃 | child.on("exit") | 自动重拉起，3 次后退�?|
| Esc 取消 | trigger stdin 监听 | 丢弃音频，回到就绪状�?|
| waitReady 超时 | 60s 定时�?| reject �?打印错误并退�?|
| 空闲超时 | ExecutorRegistry 计时�?| 释放 cc 进程，节省内�?|
| dispose 超时 | 1s 宽限 | kill 兜底，确保无孤儿进程 |

### 10.1 调试日志

开发阶段可�?`src/main.ts`、`src/trigger/index.ts`、`src/trigger/terminalKeys.ts`、`src/stt/workerClient.ts` 等关键模块中启用文件日志�?

```typescript
// 各模块顶部的 log() 函数
const LOG_FILE = join(process.cwd(), "VoxBridge-debug.log");
function log(msg: string) {
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}
```

日志记录内容�?
- 触发器状态转换（`onStartListening` / `onStopListening` / `onCancel`�?
- 终端按键序列解析（F9 / Esc / Ctrl+C�?
- Worker 进程生命周期（spawn / ready / exit�?
- `session.send()` 执行流程

日志文件位于项目根目�?`VoxBridge-debug.log`，可安全删除�?

---

## 11. 测试策略

```
┌─ Node 测试�?0 文件�?54 pass + 2 skip）─────────────────�?
�?                                                          �?
�? Executor�?                                               �?
�?   claudeExecutor.test.ts ── SDK 封装 / spawn / sendAnswer �?
�?   claudePath.test.ts ────── 二进制路径解�?               �?
�?   envFilter.test.ts ────── CLAUDE* 过滤 / 白名�?         �?
�?   inputQueue.test.ts ───── AsyncQueue 多轮输入            �?
�?   streamProcessor.test.ts ─ SDKMessage �?CardState         �?
�?   errorHandling.test.ts ── 错误�?/ 格式�?/ 可恢�?       �?
�?   registry.test.ts ────── 进程�?acquire/release           �?
�?   persistentExecutorLoop.test.ts 消费循环 / 事件           �?
�?   teamState.test.ts ───── 队友上限 / 状态机                �?
�?   teamHooks.test.ts ───── 观察者钩�?                      �?
�?   pty.test.ts ─────────── PTY 会话 / JsonlWatcher (28)     �?
�?                                                          �?
�? Session�?                                                �?
�?   session.test.ts ─────── Agent 会话管理                  �?
�?   persistSession.test.ts ─ 会话持久�?+ cwd 校验           �?
�?                                                          �?
�? STT / Trigger / UI�?                                     �?
�?   sttProtocol / pluginAdapter / pluginRegistry /          �?
�?   webSpeechPlugin / trigger / terminalKeys / wakeword /   �?
�?   ui / uiEnhancements / inkStore / inkWiring /            �?
�?   promptEditRecognition / dangerousTools / config         �?
�?                                                          �?
�? 集成测试（skip，需凭证）：                                  �?
�?   claudeIntegration.test.ts 真实 cc 子进程（CLAUDE_INTEGRATION=1）│
�?                                                          �?
�? 框架：node:test + mock                                    �?
�? 命令：npm test                                            �?
�?                                                          �?
└───────────────────────────────────────────────────────────�?

┌─ Python 测试 ────────────────────────────────────────────�?
�?                                                          �?
�? 单元测试�?                                               �?
�?   test_protocol.py ────── JSONL 编解�?                   �?
�?   test_vad.py ─────────── VAD 检�?                      �?
�?   test_device.py ──────── 设备检�?                      �?
�?   test_model_download.py  模型下载                       �?
�?   test_wakeword.py ────── 唤醒词匹�?                    �?
�?                                                          �?
�? 集成测试（需真实模型）：                                    �?
�?   test_whisper_integration.py  Whisper 转写              �?
�?                                                          �?
�? 框架：pytest                                              �?
�? 命令�?\.venv\Scripts\python.exe -m pytest tests/python  �?
�?                                                          �?
└───────────────────────────────────────────────────────────�?
```

---

## 12. 目录结构

```
VoxBridge/
├── src/                          Node 主进�?(TypeScript)
�?  ├── main.ts                   装配入口（创�?executor + 接线 UI 回调�?
�?  ├── config.ts                 配置加载（含 executor/claude 段）
�?  ├── env.ts                    环境变量读取
�?  ├── executor/                 CC 执行�?
�?  �?  ├── index.ts              工厂 + 全部 re-export
�?  �?  ├── claudeExecutor.ts     SDK query 封装（单次执行）
�?  �?  ├── claudePath.ts         cc 二进制路径解�?
�?  �?  ├── envFilter.ts          CLAUDE* 环境变量过滤
�?  �?  ├── inputQueue.ts         AsyncQueue 输入队列
�?  �?  ├── streamProcessor.ts    SDKMessage �?CardState
�?  �?  ├── costTracker.ts        成本/耗时累计
�?  �?  ├── crashRecovery.ts      崩溃计数�? 次上限）
�?  �?  ├── errors.ts             错误�?+ 中文格式�?
�?  �?  ├── registry.ts           进程池管�?
�?  �?  ├── persistentExecutor.ts 长期进程 + 完整消费循环
�?  �?  ├── teamState.ts          Agent Teams 状态机（≤10�?
�?  �?  ├── teamHooks.ts          Team 观察者钩�?
�?  �?  ├── types.ts              类型定义
�?  �?  └── pty/                  PTY 模式（P3 已实现）
�?  �?      ├── index.ts
�?  �?      ├── ptySession.ts     node-pty 驱动真实 claude TUI
�?  �?      └── screenWatcher.ts  JsonlWatcher 读取会话文件
�?  ├── session/                  Agent 会话
�?  �?  ├── agentSession.ts       会话管理器（�?executor�?
�?  �?  ├── dangerousTools.ts     危险工具检�?
�?  �?  ├── persistSession.ts     会话持久�?
�?  �?  └── types.ts              类型定义（含新回调）
�?  ├── stt/                      STT 客户�?
�?  �?  ├── index.ts              工厂函数
�?  �?  ├── workerClient.ts       Worker 进程管理
�?  �?  ├── protocol.ts           JSONL 编解�?
�?  �?  ├── pluginAdapter.ts      插件适配
�?  �?  ├── pluginRegistry.ts     插件注册�?
�?  �?  ├── pluginTypes.ts        插件接口
�?  �?  └── plugins/
�?  �?      └── webSpeechPlugin.ts
�?  ├── trigger/                  触发模块
�?  �?  ├── index.ts              工厂 + 全局热键/终端切换
�?  �?  ├── terminalKeys.ts       终端按键解析
�?  �?  ├── wakeword.ts           唤醒词触发器
�?  �?  └── types.ts              类型定义
�?  ├── ui/                       终端 UI
�?  �?  ├── console.ts            ANSI 输出（含 5 个新方法�?
�?  �?  ├── types.ts              UI 接口
�?  �?  ├── index.ts              UI 工厂
�?  �?  └── ink/                  ink TUI（可选）
�?  �?      ├── index.tsx
�?  �?      ├── App.tsx
�?  �?      ├── StatusBar.tsx
�?  �?      ├── RecognitionPanel.tsx
�?  �?      ├── OutputPanel.tsx
�?  �?      └── store.ts
�?  └── types/                    类型声明
�?      ├── ink.d.ts
�?      ├── react.d.ts
�?      └── node-pty.d.ts
�?
├── stt_worker/                   Python STT Worker
�?  ├── main.py                   入口 (JSONL 循环)
�?  ├── recorder.py               录音 (sounddevice)
�?  ├── vad.py                    端点检�?(silero/能量)
�?  ├── whisper_engine.py         Whisper 封装
�?  ├── device.py                 设备检�?
�?  ├── model_download.py         模型下载
�?  ├── wakeword.py               唤醒词匹�?
�?  ├── protocol.py               JSONL 编解�?
�?  └── models/                   模型目录 (silero-vad)
�?
├── tests/                        测试�?0 文件�?54 pass + 2 skip�?
�?  ├── claudeExecutor / claudePath / envFilter / inputQueue
�?  ├── streamProcessor / costTracker / crashRecovery / errors
�?  ├── registry / persistentExecutorLoop / teamState / teamHooks
�?  ├── pty / claudeIntegration（skip，需凭证�?
�?  └── session / persistSession / trigger / stt / ui / config ...
�?
├── scripts/                      脚本
�?  ├── setup-env.ps1             环境安装
�?  ├── download-model.py         模型下载
�?  ├── download_vad_model.py     VAD 模型下载
�?  ├── e2e.ts / e2e-ink.ts       E2E 冒烟
�?  ├── smoke-session.ts          会话冒烟
�?  └── verify-e2e.ps1            语音 E2E 手动验证清单
�?
├── docs/                         文档
�?  ├── arch/                     架构文档
�?  �?  ├── architecture.md       架构文档 (本文�?
�?  �?  ├── implementation-plan.md     实施计划
�?  �?  ├── user-guide.md         用户指南
�?  �?  └── e2e-verification.md   E2E 验证指南
�?  ├── handover/                 交接文档
�?  └── superpowers/              设计文档/计划
�?
├── config.json                   项目配置
├── package.json                  Node 依赖（含 node-pty�?
├── tsconfig.json                 TypeScript 配置
└── pytest.ini                    Python 测试配置
```

---

## 13. 设计决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 进程模型 | 多进�?(Node + Python + CC) | SDK 绑定 Node；Whisper 绑定 Python；CC 提供完整 coding 能力 |
| CC 控制方式 | SDK 模式 (query + spawn) | 流式输出、会话续接、工具链，参�?metabot 验证 |
| 通信协议 | JSONL over stdio | 无需端口/守护进程，崩溃可检测，日志可旁�?|
| 语音识别 | faster-whisper (本地) | 中文质量最优，隐私安全，无网络延迟 |
| 模型 | large-v3 (3GB) | 中文准确率最佳，推理性能够用 |
| 触发方式 | 全局热键 (node-global-key-listener) | F9 冲突面小，任意窗口可�?|
| TTS | 不做 | 编码回复长，屏幕看更清楚 |
| 权限模型 | bypassPermissions | 继承 Claude Code 行为，语音交互不适合逐次确认 |
| 会话续接 | Agent SDK resume | 保持上下文连贯，跨重启持久化 |
| 进程管理 | ExecutorRegistry 进程�?| 支持 Agent Teams、后台任务，空闲超时回收 |
| Agent Teams | 支持（≤10 队友�?| 并行编码协作，in-process 模式 |
| UI 显示 | 完整�?| 工具调用 + 文件变更 + 成本 + 队友面板 |

### 13.1 已确认决策（2026-08-14�?

| 决策 | 结论 | 影响 |
|---|---|---|
| **Agent Teams** | �?需�?| P4 持久进程池升级为必做，队友上�?10 |
| **UI 增强** | �?完整版（工具调用 + 文件变更 + 成本�?| P1 范围明确 |
| **配置项命�?* | �?合理（`executor` / `claude`�?| 无需变更 |
| **PTY 模式** | �?已实现（P3�?| node-pty 驱动真实 TUI�?026-08-15 完成 |
| **/background 后台任务** | 依赖持久进程�?| P4 一并支�?|

### 13.2 实施验证�?026-08-15�?

- `tsc --noEmit` �?0 错误
- `npm test` �?256 总数 / 254 pass / 0 fail / 2 skip（集成测试，需真实 cc 凭证�?
- 语音 E2E �?`scripts/verify-e2e.ps1`（需麦克风硬件手动执行）

---

## 14. 实施计划

### 14.1 阶段划分

| 阶段 | 内容 | 预计时间 | 状�?|
|---|---|---|---|
| **P0** | 基础 SDK 模式实现 | 2 �?| �?已完�?|
| **P1** | 会话持久�?+ UI 增强（完整版�?| 1 �?| �?已完�?|
| **P2** | 错误处理 + 崩溃恢复 | 1 �?| �?已完�?|
| **P3** | PTY 模式 | 1 �?| �?已完成（2026-08-15�?|
| **P4** | 持久进程�?+ Agent Teams | 2 �?| �?已完�?|

### 14.2 P0 详细任务

1. **创建 src/executor/ 目录结构**
2. **实现 ClaudeExecutor �?*
3. **实现 StreamProcessor**
4. **修改 src/session/ 使用�?executor**
5. **编写单元测试**
6. **集成测试验证**

### 14.3 P4 详细任务（Agent Teams�?

Agent Teams 需要持久进程池支持，让队友跨轮存活�?

1. **实现 ExecutorRegistry** �?管理 cc 进程池，�?chatId 映射
2. **实现 PersistentClaudeExecutor** �?长期运行�?cc 进程，支持跨轮输入队�?
3. **启用 Agent Teams 环境变量** �?`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
4. **Team 事件透传** �?TaskCreated / TaskCompleted / TeammateIdle 钩子
5. **UI 显示** �?队友状态面板（teammates + tasks�?
6. **测试** �?�?agent 并行任务、teammate 状态更�?

**Agent Teams 环境变量�?*

```
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1    # 启用
teammateMode: 'in-process'                # 无终端时强制进程内模�?
```

---

## 15. 风险与缓�?

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| SDK API 变更 | �?| 锁定 SDK 版本，添加版本检�?|
| cc 进程泄漏 | �?| 实现超时清理 + 进程池管�?|
| 会话状态不一�?| �?| 保存 cwd + sessionId，启动时校验 |
| 内存占用增加 | �?| 限制最大并发数 |

---

## 16. 附录 A：MetaBot 参考架�?

MetaBot 通过两种模式控制 Claude Code，是 VoxBridge 架构设计的重要参考�?

### 16.1 SDK 模式（主要方式）

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

// 消费 JSONL �?
for await (const msg of stream) {
  // 处理消息...
}
```

**关键参数�?*
- `--session-id` / `--resume`：会话持久化
- `--dangerously-skip-permissions`：跳过交互确�?
- `--settings`：自定义配置路径
- `--model`：模型选择

### 16.2 PTY 模式（交互式菜单�?

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

### 16.3 MetaBot 关键代码摘录

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

## 17. 附录 B：类型定义完整版

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
