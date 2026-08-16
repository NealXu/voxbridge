# Build VoxBridge standalone executable with Nuitka
# Usage: .\scripts\build_nuitka.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== Building VoxBridge with Nuitka ===" -ForegroundColor Green

# Check Nuitka is installed
python -m pip show nuitka | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing Nuitka..." -ForegroundColor Yellow
    python -m pip install nuitka
}

# Build command
$buildCmd = @(
    "python", "-m", "nuitka",
    "--standalone",
    "--onefile",
    "--enable-plugin=numpy",
    "--follow-imports",
    "--include-package=stt_worker",
    "--include-package=stt_worker.engines",
    "--include-data-dir=stt_worker/models=stt_worker/models",
    "--output-dir=dist",
    "--output-filename=voxbridge-asr.exe",
    "--windows-console-mode=attach",
    "--assume-yes-for-downloads",
    "stt_worker/main.py"
)

Write-Host "Building..." -ForegroundColor Yellow
& $buildCmd[0] $buildCmd[1..($buildCmd.Length-1)]

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Build complete: dist/voxbridge-asr.exe" -ForegroundColor Green
Write-Host ""

# Show file size
if (Test-Path "dist/voxbridge-asr.exe") {
    $size = (Get-Item "dist/voxbridge-asr.exe").Length / 1MB
    Write-Host "Executable size: $([math]::Round($size, 2)) MB" -ForegroundColor Cyan
}