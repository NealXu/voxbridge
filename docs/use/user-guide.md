# VoxBridge 用户指南

- **日期**：2026-08-14
- **版本**：0.2.0

---

## 1. 项目简介

VoxBridge 是一个语音驱动的 Claude Code CLI。你只需按住 F9 说话，本地 Whisper 将语音转为文本，再经 claude-agent-sdk 启动并控制本地 Claude Code 实例执行（v0.2.0 架构）——因此具备完整编码能力（读写文件、运行命令、调试、Agent Teams 并行协作）。全程静默，无语音回复。

**一句话**：用嘴说话代替打字，让 Claude Code 帮你写代码。

---

## 2. 系统要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 11 |
| Node.js | ≥ 20（推荐 v24+） |
| Python | 3.12+ |
| 磁盘空间 | ~3GB（Whisper 模型） |
| 网络 | 首次下载模型 + 调用 AI API |
| 硬件 | 麦克风（笔记本自带或外接） |
| API 凭证 | 已配置 `~/.claude/settings.json` 的 env 块 |

---

## 3. 安装（仅首次）

```powershell
# 1. 克隆项目
git clone https://github.com/NealXu/voxbridge.git
cd voxbridge

# 2. 安装 Python 环境 + Whisper 依赖
#    自动安装 Python 3.12（如未安装）、创建 .venv、安装依赖
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1

# 3. 安装 Node 依赖
npm install

# 4. 下载语音识别模型（~3GB）
#    方式 A：手动下载（推荐，可看到进度）
.\.venv\Scripts\python.exe scripts/download-model.py

#    方式 B：首次启动时自动下载（显示进度条）
#    跳过此步，直接 npm start 即可
```

---

## 4. 启动

```powershell
npm start
```

启动过程：

```
正在初始化语音引擎（首次启动可能需下载模型）…

⬇ ████████████░░░░░░░░ 60% 下载中…     ← 首次自动下载模型时显示

就绪，按 F9 说话（Ctrl+C 退出）          ← 就绪状态
```

---

## 5. 使用流程

### 5.1 基本交互

```
┌──────────────────────────────────────────────────────────┐
│  就绪，按 F9 说话（Ctrl+C 退出）                          │
│                                                          │
│  ① 按住 F9                                               │
│     🎙 录音中…（松开结束 / Esc 取消）                      │
│                                                          │
│  ② 对着麦克风说话                                         │
│     「创建一个 hello.py，写一个 Flask 服务器」              │
│                                                          │
│  ③ 松开 F9                                               │
│     🎤 创建一个 hello.py，写一个 Flask 服务器              │
│        (Enter 发送 / Esc 取消 / 输入修改)                  │
│                                                          │
│  ④ 按 Enter 确认发送                                      │
│     好的，我来创建 Flask 服务器。                          │
│                                                          │
│     └ ▶ Write                     ← 工具调用可视化         │
│     └ ▶ Bash(pip install flask)                          │
│                                                          │
│     已创建 hello.py，内容为 Flask 服务器代码。             │
│                                                          │
│  就绪，按 F9 说话                                         │
│                                                          │
│  ⑤ 继续说话（会话自动续接）                                │
│     「在服务器里加一个 /health 接口」                       │
│     ...                                                   │
└──────────────────────────────────────────────────────────┘
```

### 5.2 操作速查表

| 操作 | 按键 | 说明 |
|---|---|---|
| 开始录音 | 按住 F9 | 全局热键，任何窗口有效 |
| 结束录音 | 松开 F9 | 停止录音，开始识别 |
| 取消录音 | Esc | 录音中按 Esc，丢弃音频 |
| 确认发送 | Enter | 识别后确认发送文本 |
| 取消发送 | Esc | 识别后取消，不发送 |
| 修改文本 | 直接打字 | 识别后直接输入修改，再 Enter |
| 删除字符 | Backspace | 编辑模式下删除最后一个字符 |
| 退出程序 | Ctrl+C | 终止 VoxBridge |

### 5.3 交互时序图

```
  你                              VoxBridge                      AI API
  │                                  │                           │
  │── 按住 F9 ──────────────────────>│                           │
  │                                  │── {"type":"start"} ──>    │
  │   🎙 录音中…                     │       Python 开始录音      │
  │                                  │                           │
  │  「创建 hello.py」                │   麦克风采集音频           │
  │                                  │                           │
  │── 松开 F9 ──────────────────────>│                           │
  │                                  │── {"type":"stop"} ──>     │
  │                                  │   VAD 检测 → Whisper 识别  │
  │                                  │                           │
  │  🎤 创建 hello.py                │<── {"type":"result"} ──   │
  │     (Enter/Esc/修改)             │                           │
  │                                  │                           │
  │── Enter ────────────────────────>│                           │
  │                                  │── Agent SDK query() ───>  │
  │                                  │                           │── 推理
  │                                  │<── 流式文本 delta ──────  │
  │  「好的，我来创建…」              │                           │
  │                                  │                           │
  │   └ ▶ Write                     │<── 工具调用 ────────────  │
  │   └ ▶ Bash                      │                           │
  │                                  │                           │
  │  已创建 hello.py                  │<── 完成 ───────────────  │
  │                                  │                           │
  │  就绪，按 F9 说话                 │                           │
```

---

## 6. 配置说明

编辑 `config.json`：

```jsonc
{
  // ─── 语音识别 ───
  "stt": {
    "plugin": "whisper",            // "whisper"（本地）| "webspeech"（浏览器）
    "model": "large-v3",            // 模型档位（large-v3 / medium / small / base）
    "model_dir": "D:\\Models\\faster-whisper-large-v3",
    "language": "zh",               // 识别语言
    "python_path": ".venv\\Scripts\\python.exe",
    "webspeech": {                   // Web Speech 插件配置
      "language": "zh-CN",
      "port": 18765,                // 本地 HTTP/WS 端口
      "openBrowser": true           // 自动打开浏览器
    }
  },

  // ─── 触发方式 ───
  "trigger": {
    "key": "F9",                    // 触发键
    "global": true,                 // true=全局热键 | false=终端内切换
    "wakeWord": {                   // 唤醒词模式
      "enabled": false,             // 启用后免按键说话
      "phrase": "你好小助"           // 唤醒词
    }
  },

  // ─── Agent 行为 ───
  "agent": {
    "resume": true,                 // 续接上次会话（跨重启）
    "confirmDangerous": true,       // 危险操作（Write/Edit/Bash）黄色警告
    "systemPrompt": ""              // 自定义系统提示词
  },

  // ─── UI 模式 ───
  "ui": {
    "mode": "console"               // "console"（ANSI）| "ink"（React TUI）
  },

  // ─── 执行器 ───
  "executor": {
    "mode": "sdk",                  // "sdk"（Agent SDK）| "pty"（伪终端）
    "persistent": true,             // 持久进程池，跨轮复用 cc 进程
    "idleTimeoutMs": 1800000,       // 空闲超时回收（1800000ms = 30 分钟）
    "maxConcurrent": 5,             // 最大并发执行数
    "maxTeammates": 10              // 单个团队队友上限（≤10）
  },

  // ─── 本地 Claude Code ───
  "claude": {
    "path": "claude",                          // cc 可执行文件路径
    "settingsPath": "~/.claude/settings.json", // 设置文件（env 等）
    "appendSystemPrompt": "",                  // 追加系统提示词
    "model": "claude-opus-5"                   // 模型名（可选，默认走 settings）
  }
}
```

### 6.1 触发模式对比

| 模式 | 配置 | 行为 | 适用场景 |
|---|---|---|---|
| 全局热键 | `global: true` | 任意窗口按 F9 开始/松开结束 | 日常使用 |
| 终端切换 | `global: false` | 终端内按 F9 切换开/关 | 无原生模块依赖 |
| 唤醒词 | `wakeWord.enabled: true` | 说唤醒词即开始 | 免手操作（需接线） |

### 6.2 会话管理

- **自动续接**：`agent.resume: true` 时，每次启动自动续接上次会话
- **会话持久化**：session ID 保存在 `~/.voxbridge-session.json`
- **新建会话**：删除 `~/.voxbridge-session.json` 后重启

### 6.3 团队协作（Agent Teams）

直接对着麦克风说：**「创建一个 5 人团队，帮我并行重构项目」**。VoxBridge 会创建一支队友团队，把任务拆成多块并行推进，每个队友独立工作、互不阻塞。

```
┌─ Agent Teams（voxbridge-3fa5c2f1-…）────────┐
│  队友                                     │
│    ● 队友-1  工作中   重构 api/client.ts  │
│    ● 队友-2  工作中   重构 api/server.ts  │
│    ● 队友-3  空闲                         │
│    ● 队友-4  工作中   重构 lib/auth.ts    │
│    ● 队友-5  空闲                         │
│                                           │
│  任务                                     │
│    ✓ t-001  重构 api/client.ts   已完成   │
│    ○ t-002  重构 api/server.ts   进行中   │
└───────────────────────────────────────────┘
```

- **上限**：单个团队最多 **10 名队友**（`executor.maxTeammates`），超出会被拒绝并提示上限
- **UI 面板**：显示每个队友的**名字 + 状态**（工作中 / 空闲），以及团队**任务列表**（进行中 / 已完成）
- **依赖**：`executor.persistent: true`（默认开启）保持队友跨轮存活；`executor.mode` 为 `sdk` 时经 Agent SDK 控制
- **清理**：任务完成后团队自行清理；空闲超时（`idleTimeoutMs`）后进程被回收

---

## 7. 常见问题

### Q: 启动后一直显示「正在初始化」？
A: 模型加载需要 10-40 秒（取决于磁盘速度）。首次启动还需下载 3GB 模型。

### Q: 按 F9 没反应？
A: 检查麦克风是否可用。VoxBridge 启动时会检测音频设备，如果无设备会报错。

### Q: 识别不准？
A: 确保环境安静，说话清晰。可尝试切换 `model` 为 `medium`（更快但精度稍低）。

### Q: Worker 崩溃了？
A: 自动重拉起。连续 3 次崩溃才会退出。检查 Python 环境和模型完整性。

### Q: 如何切换 AI 模型/API？
A: 编辑 `~/.claude/settings.json` 的 env 块：
```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_MODEL": "deepseek-v4-flash[1m]"
  }
}
```

---

## 8. 运行测试

```bash
# Node 测试（81 个）
npm test

# Python 测试（32 个 + 2 跳过）
.\.venv\Scripts\python.exe -m pytest tests/python -v

# Whisper 集成测试（需真实模型）
.\.venv\Scripts\python.exe -m pytest tests/python -m integration -v
```
