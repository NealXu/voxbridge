# Build VoxBridge with PyInstaller (fallback if Nuitka fails)
# Usage: .\scripts\build_pyinstaller.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== Building VoxBridge with PyInstaller ===" -ForegroundColor Green

# Check PyInstaller is installed
python -m pip show pyinstaller | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing PyInstaller..." -ForegroundColor Yellow
    python -m pip install pyinstaller
}

# Build command
$buildCmd = @(
    "python", "-m", "PyInstaller",
    "--onefile",
    "--name", "voxbridge-asr",
    "--add-data", "stt_worker/models;stt_worker/models",
    "--hidden-import", "stt_worker",
    "--hidden-import", "stt_worker.engines",
    "--hidden-import", "stt_worker.engines.whisper",
    "--hidden-import", "stt_worker.engines.sensevoice",
    "--hidden-import", "stt_worker.engines.paraformer",
    "--distpath", "dist",
    "--workpath", "build",
    "--noconfirm",
    "stt_worker/main.py"
)

Write-Host "Building..." -ForegroundColor Yellow
& $buildCmd[0] $buildCmd[1..($buildCmd.Length-1)]

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Build complete: dist/voxbridge-asr.exe" -ForegroundColor Green

# Show file size
if (Test-Path "dist/voxbridge-asr.exe") {
    $size = (Get-Item "dist/voxbridge-asr.exe").Length / 1MB
    Write-Host "Executable size: $([math]::Round($size, 2)) MB" -ForegroundColor Cyan
}