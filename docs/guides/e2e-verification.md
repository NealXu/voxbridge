# VoxBridge 端到端验证（E2E�?

- **日期**�?026-08-15
- **关联文档**：`user-guide.md`（使用指南）、`implementation-plan.md`（实施计划）

本文件说明如何运�?VoxBridge 的两类端到端验证�?

1. **语音端到端（Voice E2E�?*——真实麦克风 + Whisper + F9 热键 + claude-agent-sdk 全链路，需真实硬件�?API 凭据，采�?*手动清单 + 脚本**方式�?
2. **SDK 集成测试（Agent Teams / Executor E2E�?*——真�?claude 进程会话，需 `claude` CLI �?API 凭据，采�?*跳过标记�?node:test 自动测试**方式�?

两者默认都不影响日�?`npm test`（自动测试默认跳过，语音清单纯手动）�?

---

## 1. 前置条件

| �?| 要求 |
|---|---|
| claude CLI | 已安装且可运行（`Get-Command claude` 返回路径�?|
| API 凭据 | `~/.claude/settings.json` �?`env` 块含 `ANTHROPIC_AUTH_TOKEN`（或 `ANTHROPIC_API_KEY`�?|
| Whisper 模型 | `config.json` �?`stt.model_dir` 指向�?`model.bin` 的目录（默认 `D:\Models\faster-whisper-large-v3`�?|
| 硬件 | 麦克风可用（Windows 隐私设置允许应用录音�?|
| 网络 | 可访问模型服务商 API |

---

## 2. 语音端到端（手动，真实硬件）

运行前置检�?+ 手动清单�?

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-e2e.ps1
```

脚本行为�?

1. **前置检�?*（自动判�?PASS/FAIL）：
   - `claude` CLI 可用
   - `~/.claude/settings.json` �?API 凭据（只检查存在性，不输�?token�?
   - Whisper 模型目录�?`model.bin`
   - 通过 `winmm.waveInGetNumDevs()` 探测系统录音设备
2. **手动清单**（逐项 `y/N` 征询，任一 `N` 记入失败并最�?`exit 1`）：
   - 启动 `npm start`，出现「就绪，�?F9 说话�?
   - 按住 F9 说话「create hello.py」，松开�?UI 显示识别文本，按 Enter 发�?
   - 执行结束�?`cwd` 下出�?`hello.py`
   - 执行期间 UI 显示工具调用（`�?Read` / `�?Write` / `�?Bash`�?
   - 结束�?UI 显示完成状态与耗时/成本统计
   - （可选）再次�?F9 说「在 hello.py 里加一行注释」，确认会话续接

   DryRun（不探测麦克风、不等待人工输入）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/verify-e2e.ps1 -DryRun
   ```

预期结果：前置检查全 PASS、手动清单均�?`y`，退出码 0�?

---

## 3. SDK 集成测试（自动，真实 claude 会话�?

测试文件：`tests/claudeIntegration.test.ts`，覆盖两个场景：

| 测试 | 环境变量 | 断言 |
|---|---|---|
| `createClaudeExecutor().startExecution` 真实 prompt | `CLAUDE_INTEGRATION=1` | 流式产生 `result`（非错误、非空文本、携�?session_id），对应「Executor E2E」（legacy #3 �?SDK 模式主路径） |
| Agent Teams teamState/teamHooks 与真实会话联�?| `CLAUDE_INTEGRATION=1` + `CLAUDE_TEAM_INTEGRATION=1` | 真实会话中把 SDK �?`TaskCreated`/`TaskCompleted`/`TeammateIdle` 钩子输入�?`teamObserverHook` 折叠�?`updateTeamState`，事件到达时断言 teamState 一�?|

### 3.1 默认（跳过）

```powershell
npm test
```

`node:test` �?`{ skip: reason }` 使集成测试在任何环境变量未设置时**报告�?skipped**，不会失败，不影响现�?210+ 单元测试�?

### 3.2 运行 SDK 集成测试

```powershell
$env:CLAUDE_INTEGRATION = "1"
npm test
```

另两个测试内层守卫：�?`claude` 不可解析�?`~/.claude/settings.json` 无凭据，测试仍会�?`t.skip()` 跳过（不报错）�?

可选调参：
- `CLAUDE_INTEGRATION_TIMEOUT_MS`：单次会话超时（毫秒），默认 180000（Teams 240000）。超时以 skipped 呈现�?

### 3.3 运行 Agent Teams 集成测试

```powershell
$env:CLAUDE_INTEGRATION = "1"
$env:CLAUDE_TEAM_INTEGRATION = "1"
npm test
```

注意：模型是否真的把任务下发�?teammate 属于模型行为，脚本不做强断言——若未观察到团队事件，仅输出 diagnostic（说明插件通路仍被真实会话覆盖）�?

---

## 4. 常见问题

| 现象 | 处理 |
|---|---|
| 集成测试显示 skipped | 未设 `CLAUDE_INTEGRATION=1`，属预期 |
| 集成测试超时 skipped | 检�?API 凭据 / base URL / 模型服务状态；调大 `CLAUDE_INTEGRATION_TIMEOUT_MS` |
| `verify-e2e.ps1` 麦克�?FAIL�? 设备�?| 连接/启用麦克风；检�?Windows「设�?> 隐私 > 麦克风」允许桌面应用使�?|
| `verify-e2e.ps1` 模型 FAIL | 运行 `scripts/download-model.py`（Python 3.12 + faster-whisper）或检�?`config.json` �?`model_dir` |
| 语音听不�?| 换与 `config.json` �?`stt.language` 匹配的语言（默认中文）；靠近麦克风、降�?|

---

## 5. 关联任务

- **Agent Teams 端到端实�?*：默认跳过的 `CLAUDE_TEAM_INTEGRATION=1` 测试即其自动化底座；仍需在支�?Agent Teams �?SDK/CLI 版本上人工跑通一次以获得事件流真值�?
- **端到端语音验证（需硬件�?*：由 `scripts/verify-e2e.ps1` 承载�