"""STT worker 入口：读 stdin JSONL，控制录音与识别，写 stdout JSONL。"""
import argparse
import os
import sys
import threading
import time

# 以脚本方式直接运行（python stt_worker/main.py）时 sys.path[0] 是脚本所在目录，
# 需将仓库根目录加入 sys.path，才能 import stt_worker.protocol。
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from stt_worker.protocol import decode, encode
from stt_worker.recorder import Recorder
from stt_worker.vad import has_voice, get_vad, SAMPLE_RATE
from stt_worker.whisper_engine import WhisperEngine


def emit(msg: dict) -> None:
    """向 stdout 发送一条 JSONL 消息并立即冲刷。"""
    sys.stdout.write(encode(msg))
    sys.stdout.flush()


def _force_utf8(stream) -> None:
    """强制文本流以 UTF-8 输出，并关闭换行转换。

    Windows 上 sys.stdout 指向管道时，默认是 locale 编码（中文系统为 cp936/gbk），
    Node 端按 UTF-8 读取会乱码；文本模式还会把 \\n 转成 \\r\\n。这里统一重配为
    UTF-8 + 原样换行，保证 JSONL 字节可被 Node 可靠解析。
    """
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is None:
        return  # 无 reconfigure（如测试里的 StringIO / pytest 捕获）则跳过
    try:
        reconfigure(encoding="utf-8", newline="")
    except (ValueError, OSError, UnicodeError):
        pass  # 已配好或不可重配时保持现状


def run_wake_loop(recorder: Recorder, wake_word: str, model_dir: str, language: str) -> None:
    """唤醒词循环：后台持续监听，匹配后发 {"type":"wake"} 并短暂冷却。

    设计：
      - recorder.start_persistent() 启动音频线程，按 100ms 块分发
      - 累积 VAD 有效段（voice buffer），达 1.5s 后送 whisper 识别
      - 匹配唤醒词 → emit({"type":"wake"}) + 冷却 2s 防抖
      - 不匹配 → 清空 buffer 重新累积
    """
    from stt_worker.wakeword import match_wake_word
    from faster_whisper import WhisperModel

    # 唤醒词用 tiny 模型（~40MB），比生产模型（~3GB）轻量 100 倍
    # 使用 Hugging Face 模型 ID，首次运行自动下载到缓存
    try:
        wake_model = WhisperModel("Systran/faster-whisper-tiny", device="cpu", compute_type="int8")
    except Exception as e:
        emit({"type": "error", "message": f"wake word model load failed: {e}"})
        return

    recorder.start_persistent()
    voice_buffer: list[np.ndarray] = []
    voice_duration_ms = 0
    last_wake_time = 0.0
    COOLDOWN_MS = 2000        # 唤醒后冷却
    MIN_VOICE_MS = 1500       # 最少累积 1.5s 语音才识别
    CHUNK_MS = 100            # 每块 100ms

    while True:
        chunk = recorder.get_audio_chunk(timeout=0.1)
        if chunk is None:
            continue

        if has_voice(chunk):
            voice_buffer.append(chunk)
            voice_duration_ms += CHUNK_MS
        else:
            # 静音：如果累积了足够语音，识别并检查唤醒词
            if voice_duration_ms >= MIN_VOICE_MS:
                # 冷却期内跳过
                if (time.time() * 1000 - last_wake_time) < COOLDOWN_MS:
                    voice_buffer = []
                    voice_duration_ms = 0
                    continue
                audio = np.concatenate(voice_buffer)
                voice_buffer = []
                voice_duration_ms = 0
                try:
                    start = time.monotonic()
                    segments, _ = wake_model.transcribe(audio, language=language, vad_filter=True)
                    text = "".join(seg.text for seg in segments).strip()
                    if text and match_wake_word(text, wake_word):
                        last_wake_time = time.time() * 1000
                        emit({"type": "wake", "phrase": wake_word, "heard": text})
                except Exception as e:
                    # 单次识别失败不影响循环
                    sys.stderr.write(f"wake transcribe error: {e}\n")
            else:
                # 语音过短，丢弃
                voice_buffer = []
                voice_duration_ms = 0


def main() -> None:
    # 管道安全：Node 以 UTF-8 读取 worker 输出（见 _force_utf8）。
    _force_utf8(sys.stdout)
    _force_utf8(sys.stderr)

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--model-dir", default=r"D:\Models\faster-whisper-large-v3")
    parser.add_argument("--language", default="zh")
    # VAD 参数（可选，全部有合理默认值）— Node 端通过 config.json 的 stt.vad 透传
    parser.add_argument("--vad-threshold", type=float, default=None,
                        help="silero-vad 语音概率阈值 (0-1)，默认 0.45")
    parser.add_argument("--vad-min-voice-ms", type=int, default=None,
                        help="有效语音最短持续时长 (ms)，默认 200")
    parser.add_argument("--vad-silence-rms", type=float, default=None,
                        help="静音 RMS 阈值，默认 1e-4")
    parser.add_argument("--vad-noise-max-rms", type=float, default=None,
                        help="有声 RMS 阈值，默认 1e-2")
    parser.add_argument("--vad-chunk-ms", type=int, default=None,
                        help="VAD 处理块大小 (ms)，默认 32")
    parser.add_argument("--vad-endpoint-silence-ms", type=int, default=None,
                        help="端点检测：静音超过此时长切分 (ms)，默认 800")
    # 唤醒词参数（可选）
    parser.add_argument("--wake-word", type=str, default=None,
                        help="启用唤醒词模式（如 '你好小助'）")
    args = parser.parse_args()

    # 应用 VAD 参数到 vad 模块的全局常量（在 get_vad() 调用前）
    from stt_worker import vad as vad_module
    if args.vad_threshold is not None:
        vad_module.DEFAULT_THRESHOLD = args.vad_threshold
    if args.vad_min_voice_ms is not None:
        vad_module.MIN_VOICE_MS = args.vad_min_voice_ms
    if args.vad_silence_rms is not None:
        vad_module.SILENCE_RMS = args.vad_silence_rms
    if args.vad_noise_max_rms is not None:
        vad_module.NOISE_MAX_RMS = args.vad_noise_max_rms
    if args.vad_chunk_ms is not None:
        vad_module.CHUNK_MS = args.vad_chunk_ms
    if args.vad_endpoint_silence_ms is not None:
        vad_module.ENDPOINT_SILENCE_MS = args.vad_endpoint_silence_ms

    # 启动时一次性加载 Whisper 模型（首次数秒、数 GB 内存），加载完成才发 ready。
    engine = WhisperEngine(args.model_dir)
    engine.load()

    # 预加载 VAD 模型（silero-vad 或能量阈值 fallback）
    vad = get_vad()
    if vad._model_loaded:
        emit({"type": "ready", "vad": "silero", "wakeWord": bool(args.wake_word)})
    else:
        emit({"type": "ready", "vad": "energy_threshold", "wakeWord": bool(args.wake_word)})

    # 唤醒词模式：启动后台识别线程
    if args.wake_word:
        wake_thread = threading.Thread(
            target=run_wake_loop,
            args=(Recorder(), args.wake_word, args.model_dir, args.language),
            daemon=True,
        )
        wake_thread.start()
        # 主线程继续处理 stdin 命令（start/stop/quit）

    recorder: Recorder | None = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = decode(line)
            if msg["type"] == "start":
                # 防御：若上一个 start 未 stop，先关掉旧录音，避免录音流双开。
                if recorder is not None:
                    recorder.stop()
                    recorder = None
                recorder = Recorder()
                recorder.start()
                emit({"type": "recording"})
            elif msg["type"] == "stop":
                audio = None
                if recorder is not None:
                    audio = recorder.stop()
                    recorder = None
                if audio is None or not has_voice(audio):
                    # 空录音 / 无有效语音（静音或短促噪声）→ 不识别，回 noise。
                    emit({"type": "noise"})
                else:
                    text, duration_ms = engine.transcribe(audio, language=args.language)
                    if text:
                        emit({"type": "result", "text": text, "duration_ms": duration_ms})
                    else:
                        emit({"type": "noise"})
            elif msg["type"] == "quit":
                break
        except Exception as e:
            # 任何单条消息处理异常（录音开/停失败、转写 OOM 等）都不应杀死 worker：
            # 发 error 消息让上层可见，然后继续处理下一条。
            emit({"type": "error", "message": str(e)})


if __name__ == "__main__":
    main()
