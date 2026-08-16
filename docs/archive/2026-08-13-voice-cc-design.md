# VoxBridge：语音驱动 Claude Code CLI 设计文档（已归档）

- **日期**：2026-08-13
- **状态**：已确认，待评审
- **平台**：Windows 11

## 1. 背景与目标

用户希望通过本机麦克风，用语音对话的方式控制 cc cli（Claude Code）进行编码，代替手动打字输入指令。目标是"按住说话 → 转文字 → cc 执行编码 → 看屏幕输出"，形成免打字的编码交互闭环。

### 核心目标

1. 用本机麦克风采集语音，识别成中文文本指令。
2. 文本指令通过 Claude Agent SDK 送入一个持久会话（与当前 `cc` 行为一致，含工具调用、文件读写、命令执行）。
3. 回复流式显示在终端屏幕上。
4. 全程静默，不引入 TTS。

### 非目标（明确不做）

- 不做语音回复/全文朗读。
- 不做独立 GUI，仅终端。
- 一期不做唤醒词、不做 Chrome Web Speech 插件（二期）。

## 2. 关键决策记录

| 决策点 | 结论 | 说明 |
|---|---|---|
| 交互模式 | 语音输入 + 屏幕输出 | 编码回复长，屏幕看更清楚 |
| STT 引擎 | 可插拔架构；一期本地 Whisper（faster-whisper），二期 Chrome Web Speech API | 预留扩展点 |
| Whisper 后端 | 安装 Python + faster-whisper | 中文质量最好 |
| Whisper 模型 | `large-v3`（约 3.08GB，中文准确率最佳） | 模型缓存存放 `D:\Models\` 下对应子目录 |
| 控制通道 | Claude Agent SDK（Node.js）独立会话 | 官方推荐的自定义 UI 方式，兼容 DeepSeek API 配置 |
| 触发方式 | 一期 push-to-talk（热键 F9）；二期唤醒词（config 开关） | 触发模块可插拔 |
| TTS | 不需要 | 全程静默 |
| 技术栈 | Node.js/TypeScript 主进程 + Python STT worker | 见架构 |

## 3. 架构总览

```
┌────────────────────────────────────────────────────────┐
│  Node.js 主进程 (TypeScript, voice-cc)                  │
│                                                        │
│  ┌───────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │ 触发模块   │  │ 会话管理器       │  │ 终端 UI        │  │
│  │ push-to-  │→ │ Agent SDK      │→ │ 录音状态/识别   │  │
│  │ talk 热键  │  │ query 循环      │  │ 文本/流式回复   │  │
│  └───────────┘  └───────┬────────┘  └───────────────┘  │
│                         │ JSONL over stdio              │
├─────────────────────────┼──────────────────────────────┤
│  Python STT worker (faster-whisper)                    │
│  ┌───────────┐  ┌──────────┐  ┌────────────────────┐   │
│  │ 录音        │  │ 端点检测   │  │ faster-whisper     │   │
│  │ sounddevice│  │ 能量+静默  │  │ 中文识别 → 文本      │   │
│  └───────────┘  └──────────┘  └────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### 进程拓扑选型理由

- **控制端必须是 Node**：Claude Agent SDK 是官方 Node SDK；备选的 Python 裸调 Anthropic API 不具备 cc 的编码行为（工具使用、权限、会话恢复）。
- **语音端用 Python**：faster-whisper（中文质量最优的本地方案）是 Python 库；录音（sounddevice）、VAD 在 Python 生态最顺。
- **通信用 stdio JSONL**：无需端口/守护进程，崩溃可重拉起，日志可旁路。

## 4. 组件详解

### 4.1 Node 主进程（`src/`，TypeScript）

#### 4.1.1 触发模块（trigger）
- 一期：`node-global-key-listener` 捕获全局热键 **F9**。按下 → 通知 STT worker 开始录音；松开 → 停止并取回识别结果。
- Esc 取消本次说话。
- 二期：唤醒词模式（`openWakeWord`/Porcupine），由 `config.trigger.wakeWord.enabled` 控制。

#### 4.1.2 会话管理器（session）
- 基于 `@anthropic-ai/claude-agent-sdk` 的 `query()`，消费流式事件：
  - 消息文本块（`stream_event.message_delta`）→ 终端流式打印
  - 工具调用/结果 → 终端以缩进块显示（文件读写、命令执行过程）
- **环境继承**：主进程读取 `~/.claude/settings.json` 的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`，写入进程 env 传给 Agent SDK，保证与当前 `cc` 行为一致（DeepSeek API）。
- **权限**：沿用 `bypassPermissions`；git 提交/推送、删除等危险操作终端醒目显示，`config.agent.confirmDangerous` 决定是否需按键确认。
- **会话恢复**：默认 `--resume` 上次会话；`--new` 开新会话。

#### 4.1.3 STT 客户端（stt-client）
- spawn Python worker 子进程，通过 stdio JSONL 收发消息。
- 崩溃自动重拉起；连续 3 次失败则报错退出。

#### 4.1.4 终端 UI（ui）
- MVP 用 ANSI 彩色输出，不引入重 TUI 依赖：
  - 录音中：`🎙 录音中…`（红点）
  - 识别文本回显：绿色，发送前可 Ctrl 修改（编辑器单行）后 Enter 确认，或直接自动发送
  - cc 回复：流式白色打印；工具调用块用灰/蓝区分
- 二期可升级为 ink TUI。

### 4.2 Python STT worker（`stt_worker/`）

#### 4.2.1 录音（record）
- `sounddevice` 采集 PCM（默认 16kHz 单声道），numpy 缓冲。

#### 4.2.2 端点检测（vad）
- 简单能量阈值 + 静默超时断句。push-to-talk 模式下，松键即断句；静默时长过短视为无效语音 → 返回 `noise` 丢弃。

#### 4.2.3 识别（recognize）
- `faster-whisper`，模型 `large-v3`，`language="zh"`，`vad_filter=true`。
- **模型路径**：显式下载到 `D:\Models\faster-whisper-large-v3`，通过 `HF_HOME`/`snapshot_download` 控制，不落默认用户目录。

### 4.3 通信协议（stdio JSONL）

每行一个 JSON 对象，UTF-8，`\n` 结尾：

```
Node → Python:  {"type":"start"}  {"type":"stop"}  {"type":"quit"}
Python → Node:  {"type":"ready"}
                {"type":"recording","vad":true}
                {"type":"result","text":"...","duration_ms":1234}
                {"type":"noise"}
                {"type":"error","message":"..."}
```

## 5. 配置（`config.json`）

```json
{
  "stt": {
    "plugin": "whisper",
    "model": "large-v3",
    "model_dir": "D:\\Models\\faster-whisper-large-v3",
    "language": "zh"
  },
  "trigger": {
    "mode": "push-to-talk",
    "key": "F9",
    "wakeWord": { "enabled": false }
  },
  "agent": {
    "resume": true,
    "confirmDangerous": true,
    "systemPrompt": ""
  },
  "ui": {
    "showRecognition": true
  }
}
```

## 6. 数据流（一次按键说话）

1. 按住 F9 → Node 发 `{"type":"start"}` → Python 开始录音 → 终端显示 `🎙 录音中…`
2. 松开 F9 → Node 发 `{"type":"stop"}`
3. Python 能量检测 → 无效则回 `noise`（不打扰 agent）；有效则 Whisper 识别 → 回 `{"type":"result","text":...}`
4. Node 回显识别文本（绿色）→ 自动发送（或 Ctrl 修改后 Enter）
5. Node 用 Agent SDK 发送 → 流式显示回复与工具调用
6. 完成后回到待命状态

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 麦克风不可用 / 无设备 | 启动时列出设备并明确报错退出 |
| Whisper 模型未下载 | 启动时自动下载 + 进度条 |
| 识别为空 / 纯噪声 | 回 `noise`，丢弃，不发送 |
| SDK 超时 / 失败 | 显示错误，保留会话可重试 |
| Python worker 崩溃 | 自动重拉起；连续 3 次失败退出 |
| 说话中途 Esc | 取消本次，丢弃音频 |

## 8. 测试

- **Python**：
  - 协议解析测试（合法/非法 JSONL 行）
  - 端点检测测试（构造静音 / 噪声 / 语音样本，断言结果分类）
  - Whisper 集成测试（一段真实中文语音 → 断言识别文本包含关键子串）
- **Node**：
  - 配置解析测试（缺省值、非法值）
  - 会话管理器测试（mock Agent SDK 事件流）
  - STT 协议客户端测试（mock worker 进程）
- **端到端**：脚本模拟 F9 按下 → 断言 agent 收到正确文本指令

## 9. 环境依赖

- Node.js ≥ 20（已装 v24.13.1）
- Python 3.11+（需安装，`winget install Python.Python.3.12`）
- Python 包：`faster-whisper`、`sounddevice`、`numpy`
- npm 包：`@anthropic-ai/claude-agent-sdk`、`node-global-key-listener`
- 模型：`Systran/faster-whisper-large-v3`（约 3.08GB，下载到 `D:\Models\faster-whisper-large-v3`）

## 10. MVP 范围与二期

### 一期（MVP）
Node 主进程 + F9 push-to-talk + Python/Whisper worker + Agent SDK 会话 + 流式终端显示 + 基础配置。跑通"按住说话 → 编码 → 看屏幕"闭环。

### 二期
- 唤醒词触发（config 开关）
- Chrome Web Speech API 插件（STT 插件注册表扩展）
- 危险操作按键确认细化
- ink TUI 美化（可选状态播报）

## 11. 风险

| 风险 | 缓解 |
|---|---|
| large-v3 中文识别有 3-6s 延迟 | push-to-talk 下可接受；模型降级为 medium 作为备选配置 |
| Windows 全局热键与系统/输入法冲突 | F9 冲突面小；触发键可配置 |
| Agent SDK 对 DeepSeek 兼容性未知 | 规划阶段先做 SDK 最小冒烟测试（query 一条消息） |
| 首次模型下载 3.08GB | 启动时进度条 + 断点续传（huggingface_hub 支持） |
