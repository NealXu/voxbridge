# Voxcode

Voice-controlled Claude Code CLI. Press-to-talk (default `F9`) to capture audio, transcribe it locally with `faster-whisper`, and feed the result into Claude Code.

## Setup

1. Run `powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1` to install Python, create `.venv`, and install `faster-whisper` / `sounddevice` / `numpy` / `pytest`.
2. Run `.\.venv\Scripts\python.exe scripts\download-model.py` to fetch the Whisper `large-v3` model (~2.9 GB) into `D:\Models\faster-whisper-large-v3`.
3. Run `npm install` to install the Node dependencies.

## Start

`npm start` launches the CLI (see `config.json` to change the trigger key, model, or language).
