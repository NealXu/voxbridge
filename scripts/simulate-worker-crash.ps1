<#
.SYNOPSIS
    模拟 STT worker 崩溃，验�?main.ts 的崩溃恢复逻辑�?

.DESCRIPTION
    流程�?
      1. 启动 VoxBridge（Node 主进�?+ Python worker�?
      2. �?worker ready（stdout 出现 {"type":"ready"...}�?
      3. 通过 taskkill 强制杀�?worker 进程（模拟崩溃）
      4. 观察 main.ts 的日志输出：
         - "worker crashed" + lastStderr
         - "Worker 崩溃�?s 后重启�?
         - �?worker spawn 日志
         - "就绪，按 F9 说话"
      5. 可选：重复杀�?N 次验�?3 次上限触�?fatal exit

.PARAMETER CrashCount
    要杀死的次数。默�?1。设�?3 验证退出阈值�?

.PARAMETER VoxBridgeArgs
    传给 VoxBridge 的额外参数（默认 ./config.json）�?

.EXAMPLE
    .\scripts\simulate-worker-crash.ps1
    .\scripts\simulate-worker-crash.ps1 -CrashCount 3
#>

[CmdletBinding()]
param(
    [int]$CrashCount = 1,
    [string]$VoxBridgeArgs = "./config.json"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

New-Item -ItemType Directory -Force -Path "logs" | Out-Null

Write-Host "`n==[ simulate-worker-crash ]==" -ForegroundColor Cyan
Write-Host "repo:       $repoRoot"
Write-Host "crashes:    $CrashCount"
Write-Host "VoxBridge:    $(Get-Date -Format 'HH:mm:ss')"
Write-Host ""

# 启动 VoxBridge，捕�?stdout/stderr
$VoxBridge = Start-Process -FilePath "node" `
    -ArgumentList "dist/main.js", $VoxBridgeArgs `
    -RedirectStandardOutput "logs/simulate-stdout.log" `
    -RedirectStandardError "logs/simulate-stderr.log" `
    -PassThru `
    -NoNewWindow

try {
    Write-Host "VoxBridge PID: $($VoxBridge.Id)" -ForegroundColor Yellow

    # �?worker ready（最�?60s�?
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
        Write-Host "ERROR: worker 未在 60s �?ready" -ForegroundColor Red
        Write-Host "stdout log:" -ForegroundColor Yellow
        Get-Content "logs/simulate-stdout.log" -ErrorAction SilentlyContinue
        Write-Host "stderr log:" -ForegroundColor Yellow
        Get-Content "logs/simulate-stderr.log" -ErrorAction SilentlyContinue
        exit 2
    }
    Write-Host "worker ready" -ForegroundColor Green

    # 找到 python worker 进程（VoxBridge 的子进程�?
    $workers = Get-CimInstance Win32_Process |
        Where-Object { $_.ParentProcessId -eq $VoxBridge.Id -and $_.Name -match "python" }
    if (-not $workers) {
        Write-Host "ERROR: 找不�?python worker 子进�? -ForegroundColor Red
        exit 3
    }
    $workerPid = $workers[0].ProcessId
    Write-Host "worker PID: $workerPid" -ForegroundColor Yellow

    # 循环杀�?worker
    for ($i = 1; $i -le $CrashCount; $i++) {
        Write-Host "`n--[ crash #$i ]--" -ForegroundColor Cyan
        # 强制终止（等�?SIGKILL），模拟崩溃
        taskkill /F /PID $workerPid 2>&1 | Write-Host
        Start-Sleep -Seconds 2

        if ($VoxBridge.HasExited) {
            Write-Host "VoxBridge 已退出（code=$($VoxBridge.ExitCode)�? -ForegroundColor $(
                if ($i -eq $CrashCount -and $CrashCount -ge 3) { "Green" } else { "Red" }
            )
            break
        }

        # 等下一�?worker ready
        $deadline = (Get-Date).AddSeconds(60)
        $stdoutBefore = if (Test-Path "logs/simulate-stdout.log") {
            (Get-Content "logs/simulate-stdout.log" -Raw -ErrorAction SilentlyContinue)
        } else { "" }
        $ready = $false
        while ((Get-Date) -lt $deadline) {
            $content = Get-Content "logs/simulate-stdout.log" -Raw -ErrorAction SilentlyContinue
            # 找比之前多的 ready �?
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
                Where-Object { $_.ParentProcessId -eq $VoxBridge.Id -and $_.Name -match "python" }
            if ($workers) { $workerPid = $workers[0].ProcessId }
        } else {
            Write-Host "worker 未在 60s 内重�? -ForegroundColor Red
        }
    }

    # �?VoxBridge 自然退出（如果 3 次崩溃触发）或继续运�?
    if (-not $VoxBridge.HasExited) {
        Write-Host "`nVoxBridge 仍在运行（PID=$($VoxBridge.Id)）。等 10s 后自动停�?.."
        Start-Sleep -Seconds 10
        if (-not $VoxBridge.HasExited) {
            Stop-Process -Id $VoxBridge.Id -Force
        }
    }

    Write-Host "`n==[ 日志输出 ]==" -ForegroundColor Cyan
    Write-Host "--- stdout (last 30 lines) ---"
    Get-Content "logs/simulate-stdout.log" -Tail 30
    Write-Host "--- stderr (last 30 lines) ---"
    Get-Content "logs/simulate-stderr.log" -Tail 30

    exit 0
} finally {
    if (-not $VoxBridge.HasExited) {
        Stop-Process -Id $VoxBridge.Id -Force -ErrorAction SilentlyContinue
    }
}
