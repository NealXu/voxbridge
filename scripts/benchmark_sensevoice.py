"""Benchmark SenseVoice vs Whisper performance."""
import time
import numpy as np
from pathlib import Path


def benchmark_engine(engine, audio: np.ndarray, runs: int = 5):
    """Run benchmark for an engine.

    Args:
        engine: Engine instance to benchmark
        audio: Audio data as numpy array
        runs: Number of benchmark runs

    Returns:
        Dict with benchmark results
    """
    # Warmup
    try:
        engine.transcribe(audio)
    except Exception as e:
        print(f"  Warmup failed: {e}")
        return None

    # Benchmark
    times = []
    for _ in range(runs):
        try:
            result = engine.transcribe(audio)
            times.append(result.duration_ms)
        except Exception as e:
            print(f"  Run failed: {e}")
            return None

    avg_ms = sum(times) / len(times)
    audio_duration_s = len(audio) / 16000
    rtf = (avg_ms / 1000) / audio_duration_s

    return {
        "avg_ms": avg_ms,
        "rtf": rtf,
        "audio_duration_s": audio_duration_s,
    }


def main():
    """Run benchmarks."""
    print("=== SenseVoice Benchmark ===\n")

    # Create test audio (1 second of silence)
    audio = np.zeros(16000, dtype=np.float32)
    print(f"Test audio: {len(audio)/16000:.1f}s silence\n")

    # Benchmark SenseVoice (FunASR)
    try:
        print("--- SenseVoice (FunASR) ---")
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine

        engine = SenseVoiceEngine({"model_path": "iic/SenseVoiceSmall"})
        engine.load()

        result = benchmark_engine(engine, audio)
        if result:
            print(f"Avg latency: {result['avg_ms']:.0f}ms")
            print(f"RTF: {result['rtf']:.3f}")
        else:
            print("Benchmark failed")
        print()
    except Exception as e:
        print(f"Failed: {e}\n")

    # Benchmark SenseVoice (sherpa-onnx)
    try:
        print("--- SenseVoice (sherpa-onnx) ---")
        from stt_worker.engines.sensevoice.onnx_engine import SenseVoiceOnnxEngine

        model_dir = r"D:\Models\sensevoice-onnx"
        if not Path(model_dir).exists():
            print(f"Model not found at {model_dir}, skipping\n")
        else:
            engine = SenseVoiceOnnxEngine({"model_dir": model_dir})
            engine.load()

            result = benchmark_engine(engine, audio)
            if result:
                print(f"Avg latency: {result['avg_ms']:.0f}ms")
                print(f"RTF: {result['rtf']:.3f}")
            else:
                print("Benchmark failed")
            print()
    except Exception as e:
        print(f"Failed: {e}\n")

    # Benchmark Whisper (if available)
    try:
        print("--- Whisper large-v3 (baseline) ---")
        from stt_worker.engines.whisper.engine import WhisperEngine

        model_dir = r"D:\Models\faster-whisper-large-v3"
        if not Path(model_dir).exists():
            print(f"Model not found at {model_dir}, skipping\n")
        else:
            engine = WhisperEngine({"model_dir": model_dir})
            engine.load()

            result = benchmark_engine(engine, audio)
            if result:
                print(f"Avg latency: {result['avg_ms']:.0f}ms")
                print(f"RTF: {result['rtf']:.3f}")
            else:
                print("Benchmark failed")
            print()
    except Exception as e:
        print(f"Failed: {e}\n")


if __name__ == "__main__":
    main()