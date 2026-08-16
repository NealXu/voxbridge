#!/usr/bin/env python3
"""Download ASR models for VoxBridge."""
import sys
from pathlib import Path


def download_sensevoice_onnx(target_dir: Path):
    """Download SenseVoice ONNX model."""
    print("Downloading SenseVoice ONNX model...")

    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id="csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
            local_dir=target_dir / "sensevoice-onnx",
            local_dir_use_symlinks=False,
        )
        print("✓ SenseVoice ONNX downloaded")
        return True
    except Exception as e:
        print(f"✗ Failed: {e}")
        return False


def download_paraformer_streaming(target_dir: Path):
    """Download Paraformer streaming model."""
    print("Downloading Paraformer streaming model...")

    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id="csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09",
            local_dir=target_dir / "paraformer-streaming",
            local_dir_use_symlinks=False,
        )
        print("✓ Paraformer streaming downloaded")
        return True
    except Exception as e:
        print(f"✗ Failed: {e}")
        return False


def main():
    target_dir = Path("models")
    target_dir.mkdir(exist_ok=True)

    print("=== VoxBridge Model Downloader ===\n")

    results = []

    # Download models
    results.append(("SenseVoice ONNX", download_sensevoice_onnx(target_dir)))
    print()
    results.append(("Paraformer streaming", download_paraformer_streaming(target_dir)))
    print()

    # Summary
    print("=== Summary ===")
    for name, success in results:
        status = "✓" if success else "✗"
        print(f"{status} {name}")

    if all(s for _, s in results):
        print("\nAll models downloaded successfully!")
        return 0
    else:
        print("\nSome models failed to download.")
        return 1


if __name__ == "__main__":
    sys.exit(main())