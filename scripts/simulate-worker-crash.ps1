<#
.SYNOPSIS
    模拟 STT worker 崩溃，验证 main.ts 的崩溃恢复逻辑。

.DESCRIPTION
    流程：
      1. 启动 voxcode（Node 主进程 + Python worker）
      2. 等 worker ready（stdout 出现 {"type":"ready"...}）
      3. 通过 taskkill 强制杀死 worker 进程（模拟崩溃）
      4. 观察 main.ts 的日志输出：
         - "worker crashed" + lastStderr
         - "Worker 崩溃，1s 后重启…"
         - 新 worker spawn 日志
         - "就绪，按 F9 说话"
      5. 可选：重复杀死 N 次验证 3 次上限触发 fatal exit

.PARAMETER CrashCount
    要杀死的次数。默认 1。设为 3 验证退出阈值。

.PARAMETER VoxcodeArgs
    传给 voxcode 的额外参数（默认 ./config.json）。

.EXAMPLE
    .\scripts\simulate-worker-crash.ps1
    .\scripts\simulate-worker-crash.ps1 -CrashCount 3
#>

[CmdletBinding()]
param(
    [int]$CrashCount = 1,
    [string]$VoxcodeArgs = "./config.json"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

New-Item -ItemType Directory -Force -Path "logs" | Out-Null

Write-Host "`n==[ simulate-worker-crash ]==" -ForegroundColor Cyan
Write-Host "repo:       $repoRoot"
Write-Host "crashes:    $CrashCount"
Write-Host "voxcode:    $(Get-Date -Format 'HH:mm:ss')"
Write-Host ""

# 启动 voxcode，捕获 stdout/stderr
$voxcode = Start-Process -FilePath "node" `
    -ArgumentList "dist/main.js", $VoxcodeArgs `
    -RedirectStandardOutput "logs/simulate-stdout.log" `
    -RedirectStandardError "logs/simulate-stderr.log" `
    -PassThru `
    -NoNewWindow

try {
    Write-Host "voxcode PID: $($voxcode.Id)" -ForegroundColor Yellow

    # 等 worker ready（最多 60s）
    $deadline = (Get-Date).AddSeconds(60)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-Path "logs/simulate-stdout.log") {
            $content = Get-Content "logs/simulate-stdout.log" -Raw -ErrorAction SilentlyContinue
            if ($content -match '"type":"ready"') {
                $ready = $true
                break
            }
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $ready) {
        Write-Host "ERROR: worker 未在 60s 内 ready" -ForegroundColor Red
        Write-Host "stdout log:" -ForegroundColor Yellow
        Get-Content "logs/simulate-stdout.log" -ErrorAction SilentlyContinue
        Write-Host "stderr log:" -ForegroundColor Yellow
        Get-Content "logs/simulate-stderr.log" -ErrorAction SilentlyContinue
        exit 2
    }
    Write-Host "worker ready" -ForegroundColor Green

    # 找到 python worker 进程（voxcode 的子进程）
    $workers = Get-CimInstance Win32_Process |
        Where-Object { $_.ParentProcessId -eq $voxcode.Id -and $_.Name -match "python" }
    if (-not $workers) {
        Write-Host "ERROR: 找不到 python worker 子进程" -ForegroundColor Red
        exit 3
    }
    $workerPid = $workers[0].ProcessId
    Write-Host "worker PID: $workerPid" -ForegroundColor Yellow

    # 循环杀死 worker
    for ($i = 1; $i -le $CrashCount; $i++) {
        Write-Host "`n--[ crash #$i ]--" -ForegroundColor Cyan
        # 强制终止（等同 SIGKILL），模拟崩溃
        taskkill /F /PID $workerPid 2>&1 | Write-Host
        Start-Sleep -Seconds 2

        if ($voxcode.HasExited) {
            Write-Host "voxcode 已退出（code=$($voxcode.ExitCode)）" -ForegroundColor $(
                if ($i -eq $CrashCount -and $CrashCount -ge 3) { "Green" } else { "Red" }
            )
            break
        }

        # 等下一个 worker ready
        $deadline = (Get-Date).AddSeconds(60)
        $stdoutBefore = if (Test-Path "logs/simulate-stdout.log") {
            (Get-Content "logs/simulate-stdout.log" -Raw -ErrorAction SilentlyContinue)
        } else { "" }
        $ready = $false
        while ((Get-Date) -lt $deadline) {
            $content = Get-Content "logs/simulate-stdout.log" -Raw -ErrorAction SilentlyContinue
            # 找比之前多的 ready 行
            $newReady = ($content.Length -gt $stdoutBefore.Length) -and
                ($content.Substring($stdoutBefore.Length) -match '"type":"ready"')
            if ($newReady) {
                $ready = $true
                break
            }
            Start-Sleep -Milliseconds 500
        }

        if ($ready) {
            Write-Host "worker 重启成功（第 $i 次恢复）" -ForegroundColor Green
            $workers = Get-CimInstance Win32_Process |
                Where-Object { $_.ParentProcessId -eq $voxcode.Id -and $_.Name -match "python" }
            if ($workers) { $workerPid = $workers[0].ProcessId }
        } else {
            Write-Host "worker 未在 60s 内重启" -ForegroundColor Red
        }
    }

    # 等 voxcode 自然退出（如果 3 次崩溃触发）或继续运行
    if (-not $voxcode.HasExited) {
        Write-Host "`nvoxcode 仍在运行（PID=$($voxcode.Id)）。等 10s 后自动停止..."
        Start-Sleep -Seconds 10
        if (-not $voxcode.HasExited) {
            Stop-Process -Id $voxcode.Id -Force
        }
    }

    Write-Host "`n==[ 日志输出 ]==" -ForegroundColor Cyan
    Write-Host "--- stdout (last 30 lines) ---"
    Get-Content "logs/simulate-stdout.log" -Tail 30
    Write-Host "--- stderr (last 30 lines) ---"
    Get-Content "logs/simulate-stderr.log" -Tail 30

    exit 0
} finally {
    if (-not $voxcode.HasExited) {
        Stop-Process -Id $voxcode.Id -Force -ErrorAction SilentlyContinue
    }
}
