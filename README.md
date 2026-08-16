# VoxBridge

Voice-controlled Claude Code CLI — 用语音驱动编码。按住 `F9` 说话，本地 Whisper 识别后送入 Claude Code 持久会话，流式输出到终端。

## ✨ 功能特性

- 🎙️ **语音输入**：Push-to-talk（默认 F9）或唤醒词（"你好小助"）
- 🧠 **本地 STT**：faster-whisper large-v3 模型，中文识别精准，数据不出本机
- 🔄 **会话续接**：7 天 TTL，重启后自动恢复对话上下文
- 🛡️ **崩溃恢复**：Worker 进程指数退避重启，最多 3 次自动恢复
- 🎨 **TUI 界面**：React + ink 终端 UI，支持主题切换
- 📊 **结构化日志**：命名空间日志 + 自动轮转

## 📐 架构概览

```
VoxBridge (Node.js)
├── 主控进程          ← 键盘监听 + 状态机 + UI
├── Python Worker     ← faster-whisper 语音识别
└── Claude Code CLI   ← Agent SDK 持久会话
```

详见 [架构文档](docs/architecture/architecture.md)

## 🚀 快速开始

### 安装

```powershell
# 1. 安装 Python 环境 + 依赖
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1

# 2. 下载 Whisper 模型（~3.08 GB）
.\.venv\Scripts\python.exe scripts\download-model.py

# 3. 安装 Node 依赖
npm install
```

### 启动

```bash
npm start
```

配置项见 [config.json](config.json)：触发键、模型路径、语言等。

## 📚 文档

| 文档 | 说明 |
|------|------|
| [用户指南](docs/guides/user-guide.md) | 安装、使用、配置、FAQ |
| [架构设计](docs/architecture/) | 系统架构、状态机、TUI 设计 |
| [操作指南](docs/guides/) | VAD 调优、日志系统、端到端验证 |
| [功能说明](docs/features/) | 会话续接、唤醒词、崩溃恢复 |

## 🧪 测试

```bash
# Node 测试（347 个）
npm test

# Python 测试
.\.venv\Scripts\python.exe -m pytest tests/python -v
```

## 📄 License

MIT
