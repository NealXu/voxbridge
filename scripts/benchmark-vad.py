"""VAD 参数基准测试：扫描阈值网格，输出延迟/准确率权衡。

用法：
  python scripts/benchmark-vad.py --audio tests/fixtures/sample_voice.wav
  python scripts/benchmark-vad.py --audio tests/fixtures/sample_voice.wav --thresholds 0.3,0.4,0.5,0.6

输出 CSV 列：
  threshold, minVoiceMs, chunkMs, latency_ms, speech_detected
"""
import argparse
import csv
import sys
import time
from pathlib import Path
import numpy as np
import soundfile as sf

# 仓库根目录加入 sys.path，才能 import stt_worker.*
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from stt_worker import vad as vad_module
from stt_worker.vad import get_vad, SileroVAD


def load_audio(path: Path) -> np.ndarray:
    """加载音频文件为 float32 mono 16kHz。"""
    data, sr = sf.read(str(path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)  # 立体声转单声道
    if sr != 16000:
        # 简单重采样（最近邻，仅用于基准测试）
        ratio = 16000 / sr
        indices = (np.arange(int(len(data) * ratio)) / ratio).astype(int)
        data = data[indices]
    return data


def benchmark(vad: SileroVAD, audio: np.ndarray, threshold: float) -> dict:
    """测量单次推理延迟与语音判定。"""
    # 预热
    vad.is_speech(audio[:512], threshold=threshold)

    # 计时 10 次取均值
    start = time.perf_counter()
    for _ in range(10):
        vad.is_speech(audio, threshold=threshold)
    elapsed_ms = (time.perf_counter() - start) / 10 * 1000

    is_speech = vad.is_speech(audio, threshold=threshold)
    return {
        "threshold": threshold,
        "minVoiceMs": vad_module.MIN_VOICE_MS,
        "chunkMs": vad_module.CHUNK_MS,
        "latency_ms": round(elapsed_ms, 2),
        "speech_detected": is_speech,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", required=True, help="测试音频文件路径（wav/flac）")
    parser.add_argument(
        "--thresholds",
        default="0.3,0.4,0.45,0.5,0.6,0.7",
        help="逗号分隔的阈值列表",
    )
    parser.add_argument("--output", default=None, help="CSV 输出路径（默认 stdout）")
    args = parser.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.exists():
        print(f"error: {audio_path} 不存在", file=sys.stderr)
        sys.exit(2)

    thresholds = [float(t.strip()) for t in args.thresholds.split(",")]
    audio = load_audio(audio_path)
    print(f"loaded {audio_path}: {len(audio)} samples = {len(audio)/16000:.2f}s @ 16kHz", file=sys.stderr)

    vad = get_vad()
    if not vad._model_loaded:
        print("warn: silero-vad 未加载，使用能量 fallback", file=sys.stderr)

    rows = []
    for t in thresholds:
        result = benchmark(vad, audio, t)
        rows.append(result)
        status = "VOICE" if result["speech_detected"] else "silence"
        print(
            f"  threshold={t:.2f}  latency={result['latency_ms']:.1f}ms  -> {status}",
            file=sys.stderr,
        )

    # 写 CSV
    out = open(args.output, "w", newline="", encoding="utf-8") if args.output else sys.stdout
    writer = csv.DictWriter(out, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
    if args.output:
        out.close()
        print(f"wrote {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
