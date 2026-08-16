# Create distribution package for VoxBridge
# Usage: .\scripts\package_distribution.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== Creating VoxBridge Distribution Package ===" -ForegroundColor Green

# Check if executable exists
if (-not (Test-Path "dist/voxbridge-asr.exe")) {
    Write-Host "Executable not found. Run build_nuitka.ps1 first." -ForegroundColor Red
    exit 1
}

# Create package directory
$packageDir = "dist/voxbridge-asr-portable"
if (Test-Path $packageDir) {
    Remove-Item -Recurse -Force $packageDir
}
New-Item -ItemType Directory -Path $packageDir | Out-Null

# Copy executable
Write-Host "Copying executable..." -ForegroundColor Yellow
Copy-Item "dist/voxbridge-asr.exe" $packageDir/

# Copy config template
if (Test-Path "config/config.example.json") {
    Copy-Item "config/config.example.json" $packageDir/config.json
}

# Create README
Write-Host "Creating README..." -ForegroundColor Yellow
$readmeContent = @"
VoxBridge ASR Worker - Standalone Executable
==============================================

This is the standalone ASR (Automatic Speech Recognition) worker for VoxBridge.

Quick Start:
1. Download models (requires internet):
   .\download_models.py

2. Run the ASR worker:
   .\voxbridge-asr.exe

3. The worker will start listening for commands on stdin

Configuration:
The worker uses the following models by default:
- SenseVoice ONNX (~230MB) - Best for Chinese/English/Japanese/Korean
- Paraformer streaming (~200MB) - Real-time ASR

Models Directory Structure:
models/
  sensevoice-onnx/       # SenseVoice ONNX model files
  paraformer-streaming/  # Paraformer streaming model files

Requirements:
- Windows 10/11
- 2GB RAM minimum (4GB recommended)
- Microphone (for live transcription)

Supported Languages:
- Chinese (Mandarin)
- English
- Japanese
- Korean
- Cantonese

For more information, visit:
https://github.com/yourusername/voxbridge
"@
$readmeContent | Out-File -FilePath "$packageDir/README.txt" -Encoding UTF8

# Copy download script
if (Test-Path "scripts/download_models.py") {
    Copy-Item "scripts/download_models.py" $packageDir/
}

# Create models directory placeholder
New-Item -ItemType Directory -Path "$packageDir/models" -Force | Out-Null
@"
# Models Directory
Place your downloaded models here:
- sensevoice-onnx/
- paraformer-streaming/
"@ | Out-File -FilePath "$packageDir/models/.gitkeep" -Encoding UTF8

# Create ZIP archive
Write-Host "Creating ZIP archive..." -ForegroundColor Yellow
$zipPath = "dist/voxbridge-asr-portable.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath
}
Compress-Archive -Path $packageDir -DestinationPath $zipPath

# Show results
$zipSize = (Get-Item $zipPath).Length / 1MB
Write-Host ""
Write-Host "✓ Package created: $zipPath" -ForegroundColor Green
Write-Host "  Size: $([math]::Round($zipSize, 2)) MB" -ForegroundColor Cyan
Write-Host ""
Write-Host "Contents:" -ForegroundColor Yellow
Get-ChildItem $packageDir | ForEach-Object {
    Write-Host "  - $($_.Name)"
}