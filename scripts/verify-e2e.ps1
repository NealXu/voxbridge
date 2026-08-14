# ===========================================================================
# voxcode 端到端（Voice E2E）手动验证脚本
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts/verify-e2e.ps1
#
# 干跑（不等待人工输入、只输出清单，硬件/前置检查照常）:
#   powershell -ExecutionPolicy Bypass -File scripts/verify-e2e.ps1 -DryRun
#
# 作用:
#   1. 检查前置条件（claude CLI、~/.claude/settings.json 凭据、Whisper 模型、麦克风）
#   2. 打印手动验证清单（启动 voxcode -> 按 F9 -> 说 "create hello.py" -> 检查产物与 UI）
#   3. 逐项征询通过/失败，汇总后返回退出码（0=全部通过，1=存在失败项）
# ===========================================================================
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

$script:ManualChecks = @()

# --------------------------------------------------------------------------
# 工具函数
# --------------------------------------------------------------------------
function Write-Section($Title) {
  Write-Host ""
  Write-Host ("=" * 60) -ForegroundColor Cyan
  Write-Host ("  $Title") -ForegroundColor Cyan
  Write-Host ("=" * 60) -ForegroundColor Cyan
}

function ConvertTo-BoolStr([bool]$Value) {
  if ($Value) { return "PASS" } else { return "FAIL" }
}

function Test-Step {
  param([string]$Label, [bool]$Pass, [string]$Detail = "")
  $tag = ConvertTo-BoolStr $Pass
  $color = if ($Pass) { "Green" } else { "Red" }
  Write-Host ("  [{0}] {1}" -f $tag, $Label) -ForegroundColor $color
  if ($Detail -and -not $Pass) {
    Write-Host ("        $Detail") -ForegroundColor DarkYellow
  }
  if (-not $Pass) { $script:FailCount++ }
  return $Pass
}

# 读取项目配置（优先 config.local.json 覆盖）
function Get-VoxConfig {
  $localCfg = Join-Path $RepoRoot "config.local.json"
  $cfgPath  = if (Test-Path $localCfg) { $localCfg } else { Join-Path $RepoRoot "config.json" }
  try {
    return Get-Content -Raw -Path $cfgPath | ConvertFrom-Json
  } catch {
    Write-Host "  [WARN] 无法解析 $cfgPath : $_" -ForegroundColor DarkYellow
    return $null
  }
}

# 麦克风探测：winmm.waveInGetNumDevs() > 0 表示本机有可用录音设备
$script:MicCount = -1
try {
  Add-Type -Namespace Voxcode -Name WinMM -MemberDefinition @'
[DllImport("winmm.dll")]
public static extern uint waveInGetNumDevs();
'@
  $script:MicCount = [Voxcode.WinMM]::waveInGetNumDevs()
} catch {
  $script:MicCount = -1
}

# 征询一项手动检查的结果
function Ask-Manual {
  param([string]$Step, [string]$Instruction)
  Write-Host ""
  Write-Host ("  STEP: $Step") -ForegroundColor Yellow
  Write-Host ("        $Instruction") -ForegroundColor Gray
  if ($DryRun) {
    Write-Host "        [DryRun] 跳过询问，视为：待人工确认" -ForegroundColor DarkGray
    return
  }
  $answer = Read-Host "        该步骤通过了吗? (y=通过 / N=失败)"
  if ($answer -match "^y") {
    Write-Host "        [PASS]" -ForegroundColor Green
  } else {
    Write-Host "        [FAIL]" -ForegroundColor Red
    $script:FailCount++
    $script:ManualChecks += "✗ $Step"
  }
}

# --------------------------------------------------------------------------
# 1. 前置条件检查
# --------------------------------------------------------------------------
Write-Section "1/2 前置条件检查"

# 1.1 claude CLI
$claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
$null = Test-Step "claude CLI 可用（Get-Command claude）" `
  -Pass ($null -ne $claudeCmd) `
  -Detail "请先安装 Claude Code：npm install -g @anthropic-ai/claude-code"
if ($claudeCmd) { Write-Host "        -> $($claudeCmd.Source)" -ForegroundColor DarkGray }

# 1.2 API 凭据（~/.claude/settings.json 的 env 块）
$userSettings = Join-Path $env:USERPROFILE ".claude\settings.json"
$hasToken = $false
if (Test-Path $userSettings) {
  try {
    $settings = Get-Content -Raw -Path $userSettings | ConvertFrom-Json
    $hasToken = $null -ne $settings.env.ANTHROPIC_AUTH_TOKEN -or $null -ne $settings.env.ANTHROPIC_API_KEY
  } catch { $hasToken = $false }
}
$null = Test-Step "API 凭据存在（~/.claude/settings.json env 块含 Auth Token/API Key）" `
  -Pass $hasToken `
  -Detail "请设置 ANTHROPIC_AUTH_TOKEN（或 ANTHROPIC_API_KEY）后再运行"

# 1.3 Whisper 模型目录
$config = Get-VoxConfig
$modelDir = ""
if ($config -and $config.stt.model_dir) {
  $modelDir = [Environment]::ExpandEnvironmentVariables($config.stt.model_dir)
} else {
  $modelDir = Join-Path $RepoRoot "models"
}
$modelBin = Join-Path $modelDir "model.bin"
$modelDirOk = Test-Path $modelBin
$null = Test-Step "Whisper 模型存在（$modelDir\model.bin）" `
  -Pass $modelDirOk `
  -Detail "模型目录未就绪，请运行：$($config.stt.python_path) scripts/download-model.py （或由启动脚本自动下载）"

# 1.4 麦克风
$micOk = $script:MicCount -gt 0
$micDetail = if ($script:MicCount -lt 0) {
  "无法探测录音设备（可能在受限环境）。请手动确认麦克风已连接且未被禁用。"
} elseif ($script:MicCount -eq 0) {
  "系统报告 0 个录音设备。请连接麦克风，或检查 Windows 隐私设置允许应用使用麦克风。"
} else {
  "探测到 $script:MicCount 个录音设备。"
}
$null = Test-Step "麦克风可用（检测到 $($script:MicCount) 个录音设备）" `
  -Pass $micOk `
  -Detail $micDetail

# 1.5 测试脚手架（可选，用于 SDK 集成测试）
$claudeAvailable = $null -ne $claudeCmd
$null = Test-Step "SDK 端到端测试可启用（CLAUDE_INTEGRATION=1 时不得跳过）" `
  -Pass $claudeAvailable `
  -Detail "claude CLI 缺失时 tests/claudeIntegration.test.ts 会在前置检查环节自动跳过"

# --------------------------------------------------------------------------
# 2. 手动验证清单
# --------------------------------------------------------------------------
Write-Section "2/2 手动验证清单（语音端到端）"

Write-Host ""
Write-Host "  提示：以下检查需要你亲自操作完成。语音识别、模型输出存在个体差异，" -ForegroundColor Gray
Write-Host "  请把每次操作的实际现象与预期对比后再作答。" -ForegroundColor Gray

# 2.1
Ask-Manual -Step "启动 voxcode" -Instruction "在项目根目录执行 npm start，观察到就绪横幅「就绪，按 F9 说话」"
# 2.2
Ask-Manual -Step "按住 F9 说话"  -Instruction "按住 F9，出现「🎙 录音中」，说：create hello.py"
# 2.3
Ask-Manual -Step "识别结果确认" -Instruction "松开 F9，UI 应显示识别文本「create hello.py」；按 Enter 发送"
# 2.4
Ask-Manual -Step "文件产物出现" -Instruction "等待执行结束，确认 cwd 下出现 hello.py（可用 ls hello.py 或资源管理器核对）"
# 2.5
Ask-Manual -Step "UI 展示工具调用" -Instruction "执行期间 UI 应逐行显示工具调用（如 ▶ Read / ▶ Write / ▶ Bash）"
# 2.6
Ask-Manual -Step "完成任务统计"  -Instruction "执行结束后 UI 应显示完成状态与耗时（如 ✓ complete，duration/cost）"
# 2.7
Ask-Manual -Step "会话续接（可选）" -Instruction "再次按住 F9 说「在 hello.py 里加一行注释」，确认同一会话续接并修改文件"

# --------------------------------------------------------------------------
# 3. SDK 集成测试提示
# --------------------------------------------------------------------------
Write-Host ""
Write-Section "附: SDK 集成测试命令（自动测试，非语音）"
Write-Host ""
Write-Host "  默认（跳过集成测试，仅单元测试，应全部通过）:"
Write-Host "      npm test" -ForegroundColor Gray
Write-Host ""
Write-Host "  跑真实 claude 进程的集成测试:"
Write-Host "      CLAUDE_INTEGRATION=1 npm test" -ForegroundColor Gray
Write-Host ""
Write-Host "  额外开启 Agent Teams 集成测试:"
Write-Host "      CLAUDE_INTEGRATION=1 CLAUDE_TEAM_INTEGRATION=1 npm test" -ForegroundColor Gray
Write-Host ""
Write-Host "  详见 docs/arch/e2e-verification.md" -ForegroundColor Gray

# --------------------------------------------------------------------------
# 汇总
# --------------------------------------------------------------------------
Write-Section "验证结果汇总"
if ($script:FailCount -gt 0) {
  Write-Host "  存在 $script:FailCount 项失败。" -ForegroundColor Red
  foreach ($item in $script:ManualChecks) {
    Write-Host "    $item" -ForegroundColor Red
  }
  Write-Host ""
  Write-Host "  请解决上述问题后重跑本脚本。" -ForegroundColor DarkYellow
  exit 1
} else {
  Write-Host "  全部前置条件通过，手动检查项已逐项确认（DryRun 模式除外）。" -ForegroundColor Green
  exit 0
}