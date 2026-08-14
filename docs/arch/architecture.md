# voxcode 架构文档

- **日期**：2026-08-14
- **版本**：0.2.0
- **状态**：已确认（对应 design：`architecture-v2-design.md`）

---

## 1. 架构总览

voxcode 采用**多进程架构**：Node.js 主进程作为语音控制器，通过 claude-agent-sdk 启动并控制本地 Claude Code 实例执行 coding 任务；Python 子进程负责语音采集和识别。

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
│  │  │  │  ├─ Agent Teams（最多 10 队友）                           │   │ ││
│  │  │  │  └─ 工具链                                                │   │ ││
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

---

## 2. 进程拓扑

### 2.1 Node.js 主进程

| 模块 | 文件 | 职责 |
|---|---|---|
| **入口** | `src/main.ts` | 装配所有模块，生命周期管理 |
| **配置** | `src/config.ts` | 加载 config.json，合并默认值 |
| **环境变量** | `src/env.ts` | 读取 ~/.claude + .claude 的 env 块 |
| **触发模块** | `src/trigger/` | F9 热键 / 终端切换 / 唤醒词 |
| **STT 客户端** | `src/stt/` | 管理 Python worker 子进程 |
| **CC 执行器** | `src/executor/` | 启动/控制 Claude Code 进程 |
| **会话管理** | `src/session/` | 会话持久化、续接 |
| **终端 UI** | `src/ui/` | ANSI console / ink TUI |

### 2.2 Claude Code 实例（子进程）

| 方面 | 说明 |
|---|---|
| **二进制** | 本机 `claude`（`where claude` / `which claude` 解析） |
| **启动参数** | `--session-id` / `--resume` / `--dangerously-skip-permissions` / `--settings` / `--model` |
| **通信** | SDK `query()` 返回 JSONL 流 |
| **会话文件** | `~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl` |
| **生命周期** | 由 ExecutorRegistry 管理，空闲超时回收 |

### 2.3 Python STT Worker

| 模块 | 文件 | 职责 |
|---|---|---|
| **入口** | `stt_worker/main.py` | stdio JSONL 协议循环 |
| **录音** | `stt_worker/recorder.py` | sounddevice 采集 PCM |
| **端点检测** | `stt_worker/vad.py` | silero-vad / 能量阈值 fallback |
| **识别引擎** | `stt_worker/whisper_engine.py` | faster-whisper 封装 |
| **设备检测** | `stt_worker/device.py` | 启动时检查麦克风可用性 |
| **模型下载** | `stt_worker/model_download.py` | 自动下载缺失模型 |
| **唤醒词** | `stt_worker/wakeword.py` | 唤醒词匹配 |
| **协议** | `stt_worker/protocol.py` | JSONL 编解码 |

---

## 3. 通信协议

### 3.1 Node ↔ Python（语音链路）

- **通道**：stdio（标准输入/输出管道）
- **格式**：JSONL（每行一个 JSON 对象）
- **编码**：UTF-8

```
Node → Python（命令）：
  {"type": "start"}        开始录音
  {"type": "stop"}         停止录音，请求识别结果
  {"type": "quit"}         退出 worker

Python → Node（事件）：
  {"type": "ready"}        worker 初始化完成
  {"type": "recording"}    录音已开始
  {"type": "result",       识别成功
   "text": "...",
   "duration_ms": 1234}
  {"type": "noise"}        无有效语音（静音/噪声）
  {"type": "downloading",  模型下载进度
   "progress": 0.5,
   "message": "下载中 50%"}
  {"type": "wake"}         检测到唤醒词（预留）
  {"type": "error",        错误
   "message": "..."}
```

### 3.2 Node ↔ Claude Code（编码链路）

- **通道**：SDK `query()` 异步流 + 子进程 stdin/stdout
- **格式**：SDKMessage（JSONL 结构化消息）

```
Node → CC（用户消息）：
  { "type": "user", "message": { "role": "user", "content": "..." } }

CC → Node（流式事件）：
  { "type": "stream_event", "event": { "type": "content_block_delta", "delta": { "text": "..." } } }
  { "type": "tool_use", "message": { "content": [{ "type": "tool_use", "name": "Bash", "input": {...} }] } }
  { "type": "result", "result": "...", "duration_ms": 1234, "total_cost_usd": 0.01 }
```

### 3.3 时序

```
启动：
  Node                          Python                        CC
   │                              │                            │
   │── spawn worker ────────────→ │                            │
   │                              ├── 检查麦克风               │
   │                              ├── 检查/下载模型            │
   │                              ├── 加载 Whisper (3GB)      │
   │←── {"type":"ready"} ──────── │                            │
   │                              │                            │
   │── spawn claude ─────────────────────────────────────────→ │
   │                              │                            │
   │←── SDK stream ready ───────────────────────────────────── │

语音指令：
   │── {"type":"start"} ────────→ │                            │
   │←── {"type":"recording"} ──── │                            │
   │                              ├── 录音中…                  │
   │── {"type":"stop"} ─────────→ │                            │
   │                              ├── VAD 检测                 │
   │                              ├── Whisper 转写             │
   │←── {"type":"result",...} ─── │                            │
   │                              │                            │
   │── query({ prompt }) ─────────────────────────────────────→│
   │                              │                            │
   │←── stream_event: text_delta ───────────────────────────── │
   │←── tool_use: Write ────────────────────────────────────── │
   │←── stream_event: tool_result ──────────────────────────── │
   │←── result (complete) ──────────────────────────────────── │

退出：
   │── {"type":"quit"} ─────────→ │                            │
   │                              └── exit(0)                  │
   │── finish() + abort ─────────────────────────────────────→ │
   │                              │                            │
   │                              └── exit(0)                  │
```

---

## 4. 数据流

### 4.1 一次完整的语音指令

```
时间轴 ─────────────────────────────────────────────────────────────►

[按住F9]  [说话]  [松开F9]   [VAD]   [Whisper]  [CC Executor]  [完成]
   │         │        │         │        │          │            │
   ▼         ▼        ▼         ▼        ▼          ▼            ▼
  start ────────► stop ──► 有声? ──► 转写 ──► query() ──► 就绪
  cmd            cmd    │      (3-6s)     │    spawn cc     状态
                       │                  │   + 流式事件
                  noise→丢弃        ┌──────┴──────┐
                       编辑确认   text_delta    tool_use
                       (Enter)   打印(流式)    ▶ Write
                           │                  ▶ Bash
                       发送给 CC        ┌──────┴──────┐
                                 tool_result   result
                                 ▶ 变更摘要    耗时/成本
```

### 4.2 会话生命周期

```
启动 voxcode
    │
    ├─ loadSessionId() → ~/.voxcode-session.json
    │
    ├─ 用户语音输入
    │
    └─ runOneTurn()
        ├─ 持久模式 → ExecutorRegistry.acquire(chatId)
        │   ├─ 已有进程 → 复用（刷新空闲计时器）
        │   └─ 新建进程 → spawn claude + 输入队列
        ├─ 单次模式 → ClaudeExecutor.startExecution()
        │
        ├─ 流式消费 → StreamProcessor → UI
        ├─ 完成后 → 保存 sessionId
        │
        └─ 空闲超时 → ExecutorRegistry.release(chatId)
```

---

## 5. 部署依赖

### 5.1 本机必需

```
运行时：
  Node.js ≥ 20 ──────── 主进程 + Agent SDK
  Python 3.12 ───────── STT Worker
  Claude Code CLI ───── cc 二进制（npm install -g @anthropic-ai/claude-code 或官方安装）
  .venv/ ────────────── Python 虚拟环境
    ├── faster-whisper    语音识别引擎
    ├── sounddevice       麦克风采集
    ├── numpy             音频数据处理
    ├── onnxruntime       silero-vad 推理（可选）
    └── huggingface_hub   模型下载

模型文件：
  D:\Models\faster-whisper-large-v3\
    └── model.bin (3.08 GB)
  stt_worker/models/
    └── silero_vad.onnx (可选, ~2MB)

配置文件：
  config.json ────────────────── 项目配置
  ~/.claude/settings.json ────── API 凭证 (token 不入库)
  ~/.voxcode-session.json ────── 会话续接 ID

npm 依赖：
  @anthropic-ai/claude-agent-sdk ── 启动/控制 cc 子进程
  node-global-key-listener ──────── 全局热键 (原生模块)
  ws ────────────────────────────── Web Speech 桥接
  react + ink ───────────────────── ink TUI（可选）
```

### 5.2 外部服务

```
AI API 网关（HTTPS）：
  DeepSeek:   https://api.deepseek.com/anthropic
  Anthropic:  https://api.anthropic.com

凭证来源（由 cc 子进程读取，voxcode 不接触）：
  ~/.claude/settings.json 的 env 块
    ANTHROPIC_AUTH_TOKEN
    ANTHROPIC_BASE_URL
    ANTHROPIC_MODEL

模型下载（首次）：
  HuggingFace: Systran/faster-whisper-large-v3
  silero-vad:  github.com/snakers4/silero-vad
```

### 5.3 安全边界

```
敏感数据              处理方式
─────────────────────────────────────────────────
API Token            只存 ~/.claude/settings.json
                     cc 子进程直接读取，voxcode 不处理
语音数据             仅存于内存，不落盘，不传输
                     （本地 Whisper 推理）
会话 ID              存 ~/.voxcode-session.json
                     仅包含 session UUID
代码/文件            cc 在 cwd 内操作
                     继承 Claude Code 权限模型
```

---

## 6. 模块详解

### 6.1 触发模块 (src/trigger/)

```
┌────────────────────────────────────────────────┐
│  createTrigger(config.trigger) → Trigger        │
│                                                  │
│  优先级：                                         │
│    1. wakeWord.enabled → createWakeWordTrigger() │
│    2. global=true     → createGlobalTrigger()    │
│    3. global=false    → createTerminalTrigger()   │
│                                                  │
│  Trigger 接口：                                   │
│    start(callbacks): void                        │
│    stop(): void                                  │
│                                                  │
│  Callbacks:                                      │
│    onStartListening(): void  ← 开始录音           │
│    onStopListening(): void   ← 结束录音           │
│    onCancel(): void          ← 取消              │
└────────────────────────────────────────────────┘
```

### 6.2 STT 客户端 (src/stt/)

```
┌────────────────────────────────────────────────┐
│  createSttClient(config.stt, cwd, options)       │
│    → WorkerSttClient (implements SttClient)      │
│                                                  │
│  WorkerSttClient:                                │
│    spawnFor() ── spawn python 子进程              │
│    start()    ── 发 {"type":"start"}             │
│    stop()     ── 发 {"type":"stop"} → Promise    │
│    cancel()   ── 丢弃当前录音                     │
│    waitReady()── 等待 ready 事件                  │
│    dispose()  ── quit + 等退出 + kill 兜底        │
│                                                  │
│  插件注册表：                                     │
│    createPlugin("whisper")    → WorkerSttClient   │
│    createPlugin("webspeech")  → WebSpeechPlugin   │
└────────────────────────────────────────────────┘
```

### 6.3 CC 执行器 (src/executor/)

```
┌────────────────────────────────────────────────┐
│  ClaudeExecutor (单次模式)                       │
│    startExecution(opts) → ExecutionHandle       │
│      ├─ spawn cc 子进程                          │
│      ├─ SDK query() 流式消费                     │
│      ├─ 处理 tool_use / tool_result              │
│      └─ 返回流式事件给调用方                      │
│                                                  │
│  ExecutorRegistry (持久模式)                     │
│    acquire(chatId) → PersistentClaudeExecutor    │
│      ├─ 每 chatId 一个长期 cc 进程               │
│      ├─ 空闲超时回收 (30min)                     │
│      └─ 支持 Agent Teams (≤10 队友)              │
│                                                  │
│  PersistentClaudeExecutor                        │
│    nextTurn(prompt) → TurnHandle                 │
│    resolveQuestion(toolUseId, answers)           │
│    on('spontaneous') / on('continuation-turn')   │
│    shutdown()                                    │
│                                                  │
│  StreamProcessor                                 │
│    processMessage(msg) → CardState               │
└────────────────────────────────────────────────┘
```

### 6.4 会话管理 (src/session/)

```
┌────────────────────────────────────────────────┐
│  createAgentSession(opts) → AgentSession         │
│                                                  │
│  AgentSession:                                   │
│    send(prompt) → Promise<SendResult>            │
│      ├─ 调用 CC Executor                         │
│      ├─ 消费流式事件（text_delta / tool_use）      │
│      ├─ 检测危险工具 → onDangerousTool 回调       │
│      └─ 成功后保存 sessionId                     │
│                                                  │
│    reset() → void                                │
│      └─ 清除 sessionId（内存 + 持久化文件）        │
│                                                  │
│  持久化：                                         │
│    loadSessionId(file)  → 启动时读取               │
│    saveSessionId(file, id) → 成功后写入            │
│    clearSessionId(file) → reset 时删除            │
│                                                  │
│  环境继承：                                        │
│    readSettingsEnv(cwd)                          │
│      → 合并 ~/.claude/settings.json              │
│             + .claude/settings.json 的 env 块     │
└────────────────────────────────────────────────┘
```

### 6.5 终端 UI (src/ui/)

```
┌────────────────────────────────────────────────┐
│  UI 接口 (src/ui/types.ts)                       │
│    printStatus(text): void                       │
│    printRecognition(text): void                  │
│    printAssistantDelta(text): void               │
│    printToolCall(tool): void        ← 新增       │
│    printToolResult(tool, result): void ← 新增    │
│    printFileChange(file, action): void ← 新增    │
│    printCommand(cmd, output?): void   ← 新增     │
│    printCompletion(stats): void       ← 新增     │
│    printTeamState(team): void         ← 新增     │
│    clearStatusLine(): void                       │
│    printDownloadProgress(p, m): void             │
│    promptEditRecognition(text): Promise<string?>  │
│                                                  │
│  实现：                                          │
│    createConsoleUI() → ANSI 终端输出              │
│    createInkUI()     → React/ink TUI（可选）      │
│                                                  │
│  工厂：                                          │
│    createUI(config.ui.mode) → UI                 │
└────────────────────────────────────────────────┘
```

---

## 7. 错误处理

| 场景 | 检测点 | 处理方式 |
|---|---|---|
| 麦克风不可用 | worker 启动时 device.py | error 消息 → Node 打印并退出 |
| 模型未下载 | worker 启动时 model_download.py | 自动下载 + JSONL 进度报告 |
| 识别为空/噪声 | worker VAD 检测 | 返回 noise，Node 不发送给 Agent |
| cc 二进制缺失 | resolveClaudePath() | 提示安装 `npm install -g @anthropic-ai/claude-code` |
| cc 进程崩溃 | child.on("exit") | 自动重拉起，3 次后退出 |
| SDK 流中断 | stream 迭代异常 | 显示错误，会话可重试 |
| 会话续接失败 | query resume 报错 | 清除旧 sessionId，新建会话 |
| Worker 崩溃 | child.on("exit") | 自动重拉起，3 次后退出 |
| Esc 取消 | trigger stdin 监听 | 丢弃音频，回到就绪状态 |
| waitReady 超时 | 60s 定时器 | reject → 打印错误并退出 |
| 空闲超时 | ExecutorRegistry 计时器 | 释放 cc 进程，节省内存 |
| dispose 超时 | 1s 宽限 | kill 兜底，确保无孤儿进程 |

---

## 8. 测试策略

```
┌─ Node 测试 ──────────────────────────────────────────────┐
│                                                           │
│  单元测试：                                                │
│    config.test.ts ──────── 配置加载、默认值、校验           │
│    executor.test.ts ────── CC Executor 接口               │
│    streamProcessor.test.ts 消息流处理                      │
│    sessionManager.test.ts 会话持久化                       │
│    registry.test.ts ────── 进程池管理                      │
│    terminalKeys.test.ts ── F9/Esc 按键解析                │
│    sttProtocol.test.ts ─── JSONL 编解码                   │
│                                                           │
│  集成测试：                                                │
│    session.test.ts ─────── Agent 会话管理                  │
│    trigger.test.ts ─────── 触发模块                        │
│    workerCrashRecovery.test.ts 崩溃恢复                    │
│    claudeIntegration.test.ts 真实 cc 子进程（可选，需凭证） │
│                                                           │
│  框架：node:test + mock                                    │
│  命令：npm test                                            │
│                                                           │
└───────────────────────────────────────────────────────────┘

┌─ Python 测试 ────────────────────────────────────────────┐
│                                                           │
│  单元测试：                                                │
│    test_protocol.py ────── JSONL 编解码                    │
│    test_vad.py ─────────── VAD 检测                       │
│    test_device.py ──────── 设备检测                       │
│    test_model_download.py  模型下载                       │
│    test_wakeword.py ────── 唤醒词匹配                     │
│                                                           │
│  集成测试（需真实模型）：                                    │
│    test_whisper_integration.py  Whisper 转写              │
│                                                           │
│  框架：pytest                                              │
│  命令：.\.venv\Scripts\python.exe -m pytest tests/python  │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## 9. 目录结构

```
voxcode/
├── src/                          Node 主进程 (TypeScript)
│   ├── main.ts                   装配入口
│   ├── config.ts                 配置加载
│   ├── env.ts                    环境变量读取
│   ├── executor/                 CC 执行器
│   │   ├── index.ts              工厂函数
│   │   ├── claudeExecutor.ts     单次模式封装
│   │   ├── persistentExecutor.ts 持久进程池实例
│   │   ├── registry.ts           进程池管理
│   │   ├── streamProcessor.ts    消息流处理
│   │   ├── types.ts              类型定义
│   │   └── pty/                  PTY 模式（可选）
│   │       ├── ptySession.ts
│   │       └── screenWatcher.ts
│   ├── session/                  Agent 会话
│   │   ├── agentSession.ts       会话管理器
│   │   ├── dangerousTools.ts     危险工具检测
│   │   ├── persistSession.ts     会话持久化
│   │   └── types.ts              类型定义
│   ├── stt/                      STT 客户端
│   │   ├── index.ts              工厂函数
│   │   ├── workerClient.ts       Worker 进程管理
│   │   ├── protocol.ts           JSONL 编解码
│   │   ├── types.ts              类型定义
│   │   ├── pluginTypes.ts        插件接口
│   │   ├── pluginRegistry.ts     插件注册表
│   │   └── plugins/              插件实现
│   │       └── webSpeechPlugin.ts
│   ├── trigger/                  触发模块
│   │   ├── index.ts              工厂 + 全局热键/终端切换
│   │   ├── terminalKeys.ts       终端按键解析
│   │   ├── wakeword.ts           唤醒词触发器
│   │   └── types.ts              类型定义
│   ├── ui/                       终端 UI
│   │   ├── console.ts            ANSI 输出
│   │   ├── types.ts              UI 接口
│   │   ├── index.ts              UI 工厂
│   │   └── ink/                  ink TUI（可选）
│   │       ├── index.tsx
│   │       ├── App.tsx
│   │       ├── StatusBar.tsx
│   │       ├── RecognitionPanel.tsx
│   │       ├── OutputPanel.tsx
│   │       └── TeamPanel.tsx     ← 新增
│   └── types/                    类型声明
│       ├── ink.d.ts
│       └── react.d.ts
│
├── stt_worker/                   Python STT Worker
│   ├── main.py                   入口 (JSONL 循环)
│   ├── recorder.py               录音 (sounddevice)
│   ├── vad.py                    端点检测 (silero/能量)
│   ├── whisper_engine.py         Whisper 封装
│   ├── device.py                 设备检测
│   ├── model_download.py         模型下载
│   ├── wakeword.py               唤醒词匹配
│   ├── protocol.py               JSONL 编解码
│   └── models/                   模型目录 (silero-vad)
│
├── tests/                        测试
│   ├── *.test.ts                 Node 测试
│   └── python/                   Python 测试
│
├── scripts/                      脚本
│   ├── setup-env.ps1             环境安装
│   ├── download-model.py         模型下载
│   └── download_vad_model.py     VAD 模型下载
│
├── docs/                         文档
│   ├── arch/                     架构文档
│   │   ├── user-guide.md         用户指南
│   │   ├── architecture.md       架构文档 (本文件)
│   │   ├── architecture-v2-design.md  设计文档
│   │   └── implementation-plan.md     实施计划
│   ├── handover/                 交接文档
│   └── superpowers/              设计文档/计划
│
├── config.json                   项目配置
├── package.json                  Node 依赖
├── tsconfig.json                 TypeScript 配置
└── pytest.ini                    Python 测试配置
```

---

## 10. 设计决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 进程模型 | 多进程 (Node + Python + CC) | SDK 绑定 Node；Whisper 绑定 Python；CC 提供完整 coding 能力 |
| CC 控制方式 | SDK 模式 (query + spawn) | 流式输出、会话续接、工具链，参考 metabot 验证 |
| 通信协议 | JSONL over stdio | 无需端口/守护进程，崩溃可检测，日志可旁路 |
| 语音识别 | faster-whisper (本地) | 中文质量最优，隐私安全，无网络延迟 |
| 模型 | large-v3 (3GB) | 中文准确率最佳，推理性能够用 |
| 触发方式 | 全局热键 (node-global-key-listener) | F9 冲突面小，任意窗口可用 |
| TTS | 不做 | 编码回复长，屏幕看更清楚 |
| 权限模型 | bypassPermissions | 继承 Claude Code 行为，语音交互不适合逐次确认 |
| 会话续接 | Agent SDK resume | 保持上下文连贯，跨重启持久化 |
| 进程管理 | ExecutorRegistry 进程池 | 支持 Agent Teams、后台任务，空闲超时回收 |
| Agent Teams | 支持（≤10 队友） | 并行编码协作，in-process 模式 |
| UI 显示 | 完整版 | 工具调用 + 文件变更 + 成本 + 队友面板 |
