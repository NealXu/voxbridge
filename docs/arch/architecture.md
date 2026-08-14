# voxcode 架构文档

- **日期**：2026-08-14
- **版本**：0.1.0

---

## 1. 架构总览

voxcode 采用**双进程架构**：Node.js 主进程负责 AI 会话和用户交互，Python 子进程负责语音采集和识别。两者通过 stdio JSONL 协议通信。

```
┌─────────────────────────────────────────────────────────────────┐
│  用户终端 (Windows Terminal / PowerShell)                          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Node.js 主进程 (tsx src/main.ts)                            │ │
│  │                                                              │ │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐   │ │
│  │  │ Trigger   │  │ Agent Session │  │ Terminal UI          │   │ │
│  │  │          │→ │              │→ │ (ANSI console / ink)   │   │ │
│  │  │ F9/Esc/  │  │ Claude Agent │  │                      │   │ │
│  │  │ WakeWord │  │ SDK query()  │  │ 状态/识别/回复/进度    │   │ │
│  │  └──────────┘  └──────┬───────┘  └──────────────────────┘   │ │
│  │                       │                                       │ │
│  │              JSONL over stdio                                  │ │
│  ├───────────────────────┼───────────────────────────────────────┤ │
│  │                       ▼                                         │ │
│  │  ┌──────────────────────────────────────────────────────────┐ │ │
│  │  │  Python STT Worker (子进程)                                │ │ │
│  │  │                                                           │ │ │
│  │  │  ┌─────────┐  ┌──────┐  ┌─────────────────────────────┐  │ │ │
│  │  │  │ Recorder │→│ VAD  │→│ WhisperEngine                │  │ │ │
│  │  │  │ sound-   │  │能量/ │  │ faster-whisper large-v3     │  │ │ │
│  │  │  │ device   │  │silero│  │ (3GB, CPU, int8)           │  │ │ │
│  │  │  └─────────┘  └──────┘  └─────────────────────────────┘  │ │ │
│  │  └──────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │ HTTPS (Anthropic API 兼容)
                             ▼
                  ┌─────────────────────┐
                  │  AI API 网关          │
                  │  DeepSeek / Anthropic │
                  │  (claude-agent-sdk)   │
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
| **会话管理** | `src/session/` | Agent SDK 查询，流式响应，会话续接 |
| **终端 UI** | `src/ui/` | ANSI console / ink TUI |

### 2.2 Python STT Worker

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

### 3.1 传输层

- **通道**：stdio（标准输入/输出管道）
- **格式**：JSONL（每行一个 JSON 对象）
- **编码**：UTF-8
- **换行**：`\n`
- **缓冲区**：Python 侧强制 UTF-8 + 无换行转换

### 3.2 消息类型

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

### 3.3 时序

```
启动：
  Node                        Python
   │                            │
   │── spawn worker ──────────→ │
   │                            ├── 检查麦克风
   │                            ├── 检查/下载模型
   │                            ├── 加载 Whisper (3GB)
   │←── {"type":"ready"} ────── │
   │                            │

录音：
   │── {"type":"start"} ──────→ │
   │←── {"type":"recording"} ── │
   │                            ├── 录音中…
   │── {"type":"stop"} ───────→ │
   │                            ├── VAD 检测
   │                            ├── Whisper 转写
   │←── {"type":"result",...} ─ │

退出：
   │── {"type":"quit"} ───────→ │
   │                            └── exit(0)
```

---

## 4. 数据流

### 4.1 一次完整的语音指令

```
时间轴 ─────────────────────────────────────────────────────►

[按住F9]  [说话]  [松开F9]    [VAD]  [Whisper]  [Agent]  [完成]
   │         │        │          │        │         │        │
   ▼         ▼        ▼          ▼        ▼         ▼        ▼
  start ────────► stop ──► 有声? ──► 转写 ──► query() ──► 就绪
  cmd            cmd    │       (3-6s)    │          状态
                       │                  │
                  noise→丢弃         流式事件
                       │           ┌─────┴─────┐
                  编辑确认        文本 delta   工具调用
                  (Enter)         打印         显示
                       │
                   发送给 Agent
```

### 4.2 Worker 生命周期

```
main() 启动
    │
    ├─ createSttClient()
    │   └─ spawn python stt_worker/main.py
    │       ├─ 检查麦克风 → 失败则 error + exit
    │       ├─ 检查模型 → 缺失则下载 + 进度报告
    │       └─ 加载 Whisper 模型 → ready
    │
    ├─ waitReady(60000)
    │   └─ 等待 ready 事件（或 error / 超时 / 退出）
    │
    ├─ 正常循环：start → stop → result/noise → ...
    │
    ├─ Worker 意外退出 → handleWorkerExit()
    │   ├─ consecutiveCrashes++
    │   ├─ < 3 次 → 重新 createSttClient() + waitReady()
    │   └─ ≥ 3 次 → printError + process.exit(1)
    │
    └─ SIGINT → stt.dispose() → process.exit(0)
```

---

## 5. 部署依赖

### 5.1 本机必需

```
运行时：
  Node.js ≥ 20 ──────── 主进程 + Agent SDK
  Python 3.12 ───────── STT Worker
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
  @anthropic-ai/claude-agent-sdk ── Agent 控制
  node-global-key-listener ──────── 全局热键 (原生模块)
  ws ────────────────────────────── Web Speech 桥接
  react + ink ───────────────────── ink TUI（可选）
```

### 5.2 外部服务

```
AI API 网关（HTTPS）：
  DeepSeek:   https://api.deepseek.com/anthropic
  Anthropic:  https://api.anthropic.com

凭证来源：
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
API Token            只在 ~/.claude/settings.json
                     .gitignore 排除，永不入库
语音数据             仅存于内存，不落盘，不传输
                     （本地 Whisper 推理）
会话 ID              存 ~/.voxcode-session.json
                     仅包含 session UUID
代码/文件            Agent 在本项目 cwd 内操作
                     继承 Claude Code 的权限模型
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
│  Options:                                        │
│    onExit: (reason) => void    ← 崩溃回调         │
│    onDownloading: (p, m) => void ← 下载进度       │
│                                                  │
│  插件注册表（预留）：                               │
│    createPlugin("whisper")    → WorkerSttClient   │
│    createPlugin("webspeech")  → WebSpeechPlugin   │
└────────────────────────────────────────────────┘
```

### 6.3 会话管理 (src/session/)

```
┌────────────────────────────────────────────────┐
│  createAgentSession(opts) → AgentSession         │
│                                                  │
│  AgentSession:                                   │
│    send(prompt) → Promise<SendResult>            │
│      ├─ 调用 Agent SDK query()                   │
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

### 6.4 终端 UI (src/ui/)

```
┌────────────────────────────────────────────────┐
│  UI 接口 (src/ui/types.ts)                       │
│    printStatus(text): void                       │
│    printRecognition(text): void                  │
│    printAssistantDelta(text): void               │
│    printToolLine(text): void                     │
│    printError(text): void                        │
│    printWarning(text): void                      │
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
| SDK 超时/失败 | agentSession catch | 显示错误，会话可重试 |
| Worker 崩溃 | child.on("exit") | 自动重拉起，3 次后退出 |
| Esc 取消 | trigger stdin 监听 | 丢弃音频，回到就绪状态 |
| waitReady 超时 | 60s 定时器 | reject → 打印错误并退出 |
| dispose 超时 | 1s 宽限 | kill 兜底，确保无孤儿进程 |

---

## 8. 测试策略

```
┌─ Node 测试 (81 个) ─────────────────────────────────────┐
│                                                           │
│  单元测试：                                                │
│    config.test.ts ──────── 配置加载、默认值、校验           │
│    terminalKeys.test.ts ── F9/Esc 按键解析                │
│    sttProtocol.test.ts ─── JSONL 编解码                   │
│    dangerousTools.test.ts 危险工具检测                     │
│    persistSession.test.ts 会话持久化                       │
│    promptEditRecognition 按键编辑逻辑                      │
│                                                           │
│  集成测试：                                                │
│    session.test.ts ─────── Agent 会话管理                  │
│    trigger.test.ts ─────── 触发模块                        │
│    trigger.wakeword.test.ts  唤醒词触发器                  │
│    workerCrashRecovery.test.ts 崩溃恢复                    │
│    pluginRegistry.test.ts  插件注册表                      │
│    webSpeechPlugin.test.ts  Web Speech 插件                │
│    ui.test.ts ──────────── UI 工厂                        │
│                                                           │
│  框架：node:test + mock                                    │
│  命令：npm test                                            │
│                                                           │
└───────────────────────────────────────────────────────────┘

┌─ Python 测试 (32 个 + 2 跳过) ───────────────────────────┐
│                                                           │
│  单元测试：                                                │
│    test_protocol.py ────── JSONL 编解码                    │
│    test_vad.py ─────────── VAD 检测 (12 个)               │
│    test_device.py ──────── 设备检测 (3 个)                 │
│    test_model_download.py  模型下载 (4 个)                 │
│    test_wakeword.py ────── 唤醒词匹配 (6 个)              │
│                                                           │
│  集成测试（需真实模型）：                                    │
│    test_whisper_integration.py  Whisper 转写 (2 个)       │
│                                                           │
│  Worker 协议测试：                                         │
│    test_worker_protocol.py ── 端到端 worker 行为 (4 个)    │
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
│   │       └── OutputPanel.tsx
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
│   ├── *.test.ts                 Node 测试 (12 文件)
│   └── python/                   Python 测试 (8 文件)
│
├── scripts/                      脚本
│   ├── setup-env.ps1             环境安装
│   ├── download-model.py         模型下载
│   └── download_vad_model.py     VAD 模型下载
│
├── docs/                         文档
│   ├── arch/                     架构文档
│   │   ├── user-guide.md         用户指南
│   │   └── architecture.md       架构文档 (本文件)
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
| 进程模型 | 双进程 (Node + Python) | Agent SDK 绑定 Node；Whisper 绑定 Python；stdio 通信零配置 |
| 通信协议 | JSONL over stdio | 无需端口/守护进程，崩溃可检测，日志可旁路 |
| 语音识别 | faster-whisper (本地) | 中文质量最优，隐私安全，无网络延迟 |
| 模型 | large-v3 (3GB) | 中文准确率最佳，推理性能够用 |
| 触发方式 | 全局热键 (node-global-key-listener) | F9 冲突面小，任意窗口可用 |
| TTS | 不做 | 编码回复长，屏幕看更清楚 |
| 权限模型 | bypassPermissions | 继承 Claude Code 行为，语音交互不适合逐次确认 |
| 会话续接 | Agent SDK resume | 保持上下文连贯，跨重启持久化 |
