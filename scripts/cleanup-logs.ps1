<#
.SYNOPSIS
    清理 voxcode 旧日志文件。

.DESCRIPTION
    删除 ~/.voxcode/logs/ 下超过指定天数的 .log 文件。默认 30 天。

.PARAMETER Days
    保留最近 N 天的日志。默认 30。

.PARAMETER WhatIf
    预览将被删除的文件，但不实际删除。

.EXAMPLE
    .\scripts\cleanup-logs.ps1
    删除 30 天前的日志。

.EXAMPLE
    .\scripts\cleanup-logs.ps1 -Days 7 -WhatIf
    预览删除 7 天前的日志（不实际删除）。
#>

param(
    [int]$Days = 30,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$logDir = Join-Path $env:USERPROFILE ".voxcode\logs"

if (-not (Test-Path $logDir)) {
    Write-Host "日志目录不存在: $logDir" -ForegroundColor Yellow
    exit 0
}

$cutoff = (Get-Date).AddDays(-$Days)
$candidates = Get-ChildItem -Path $logDir -Filter "*.log" -File |
    Where-Object { $_.LastWriteTime -lt $cutoff }

if ($candidates.Count -eq 0) {
    Write-Host "没有超过 $Days 天的日志文件需要清理。" -ForegroundColor Green
    exit 0
}

$totalBytes = ($candidates | Measure-Object -Property Length -Sum).Sum
$totalMb = [math]::Round($totalBytes / 1MB, 2)

Write-Host "发现 $($candidates.Count) 个超过 $Days 天的日志文件，共 $totalMb MB：" -ForegroundColor Cyan

foreach ($f in $candidates) {
    $age = [math]::Round(((Get-Date) - $f.LastWriteTime).TotalDays)
    Write-Host "  $($f.Name)  ($age 天前, $([math]::Round($f.Length / 1KB, 1)) KB)"
}

if ($WhatIf) {
    Write-Host "`n[WhatIf] 以上文件将被删除（本次未实际删除）。" -ForegroundColor Yellow
    exit 0
}

foreach ($f in $candidates) {
    try {
        Remove-Item $f.FullName -Force
        Write-Host "  已删除: $($f.Name)" -ForegroundColor Green
    } catch {
        Write-Host "  删除失败: $($f.Name) — $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n清理完成。释放 $totalMb MB。" -ForegroundColor Green
