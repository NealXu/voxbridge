# 用法: powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  winget install -e --id Python.Python.3.12
}
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install faster-whisper sounddevice numpy pytest
Write-Host "Python 环境就绪: .\.venv\Scripts\python.exe"
