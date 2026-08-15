"""STT worker 入口：读 stdin JSONL，控制录音与识别，写 stdout JSONL。"""
import argparse
import os
import sys

# 以脚本方式直接运行（python stt_worker/main.py）时 sys.path[0] 是脚本所在目录，
# 需将仓库根目录加入 sys.path，才能 import stt_worker.protocol。
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stt_worker.protocol import decode, encode
from stt_worker.recorder import Recorder
from stt_worker.vad import has_voice, get_vad
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
    # 在启动时加载可以避免首次识别的延迟，并尽早发现模型问题。
    vad = get_vad()
    if vad._model_loaded:
        emit({"type": "ready", "vad": "silero"})
    else:
        emit({"type": "ready", "vad": "energy_threshold"})

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
