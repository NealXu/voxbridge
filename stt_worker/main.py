"""STT worker 入口：读 stdin JSONL，控制录音与识别，写 stdout JSONL。"""
import argparse
import json
import os
import sys
import threading
import time

# 以脚本方式直接运行（python stt_worker/main.py）时 sys.path[0] 是脚本所在目录，
# 需将仓库根目录加入 sys.path，才能 import stt_worker.protocol。
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from stt_worker.protocol import decode, encode, EventType, WorkerCapabilities
from stt_worker.recorder import Recorder
from stt_worker.vad import has_voice, get_vad, SAMPLE_RATE
from stt_worker.engines.factory import EngineFactory, EngineRegistry
from stt_worker.engines.base import EngineState


def emit(msg: dict) -> None:
    """向 stdout 发送一条 JSONL 消息并立即冲刷。"""
    sys.stdout.write(encode(msg))
    sys.stdout.flush()


def run_standalone(args) -> None:
    """独立模式: 直接转录音频文件

    Args:
        args: 命令行参数
    """
    import soundfile as sf

    # 加载音频
    try:
        audio, sr = sf.read(args.audio_input)
    except Exception as e:
        print(f"Error loading audio file: {e}", file=sys.stderr)
        sys.exit(1)

    # 转换采样率到 16kHz
    if sr != 16000:
        try:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
        except ImportError:
            print("Error: librosa required for resampling. Install with: pip install librosa", file=sys.stderr)
            sys.exit(1)

    # 确保是单声道
    if len(audio.shape) > 1:
        audio = audio[:, 0]

    # 初始化引擎
    EngineRegistry.discover_engines()
    factory = EngineFactory({
        "model_dir": args.model_dir,
        "model": args.model,
        "language": args.language,
    })

    success, message = factory.initialize(args.engine)
    if not success:
        print(f"Error: {message}", file=sys.stderr)
        sys.exit(1)

    engine = factory.get_engine()
    if engine is None:
        print("Error: Engine not available", file=sys.stderr)
        sys.exit(1)

    # 执行转录
    try:
        result = engine.transcribe(audio.astype(np.float32), language=args.language)
    except Exception as e:
        print(f"Transcription error: {e}", file=sys.stderr)
        sys.exit(1)

    # 输出结果
    if args.output_format == "json":
        output = {
            "text": result.text,
            "duration_ms": result.duration_ms,
            "language": result.language,
        }
        if result.segments:
            output["segments"] = [
                {"start": s.get("start"), "end": s.get("end"), "text": s.get("text")}
                for s in result.segments
            ]
        if result.confidence is not None:
            output["confidence"] = result.confidence
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(result.text)


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


def get_engine_capabilities(engine, has_wake_word: bool = False) -> WorkerCapabilities:
    """从引擎获取能力信息

    Args:
        engine: STT 引擎实例
        has_wake_word: 是否启用唤醒词

    Returns:
        WorkerCapabilities 实例
    """
    try:
        info = engine.get_info()
        # 确保值为正确类型（处理 mock 对象等边缘情况）
        streaming = bool(info.supports_streaming) if hasattr(info, "supports_streaming") else False
        languages = list(info.supported_languages) if hasattr(info, "supported_languages") else ["zh"]
        confidence = bool(info.supports_confidence) if hasattr(info, "supports_confidence") else False
        word_timestamps = bool(info.supports_word_timestamps) if hasattr(info, "supports_word_timestamps") else False
    except Exception:
        streaming = False
        languages = ["zh"]
        confidence = False
        word_timestamps = False

    return WorkerCapabilities(
        streaming=streaming,
        wake_word=has_wake_word,
        languages=languages,
        confidence=confidence,
        word_timestamps=word_timestamps,
    )


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
    # Engine selection parameters
    parser.add_argument("--engine", type=str, default="whisper",
                        help="STT engine to use (whisper, sensevoice, paraformer)")
    # Standalone mode parameters
    parser.add_argument("--standalone", action="store_true",
                        help="Run in standalone mode (transcribe audio file)")
    parser.add_argument("--audio-input", type=str,
                        help="Audio file path for standalone mode")
    parser.add_argument("--output-format", choices=["json", "text"], default="json",
                        help="Output format for standalone mode")
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

    # 检查运行模式
    if args.standalone:
        if not args.audio_input:
            print("Error: --audio-input required in standalone mode", file=sys.stderr)
            sys.exit(1)
        run_standalone(args)
        return

    # 否则进入 worker 模式
    # ... worker mode implementation

    # Auto-discover and register engines
    EngineRegistry.discover_engines()

    # Create engine factory and initialize with selected engine
    engine_config = {
        "model_dir": args.model_dir,
        "model": args.model,
        "language": args.language,
    }
    factory = EngineFactory(engine_config)

    success, message = factory.initialize(args.engine, config=engine_config)
    if not success:
        # 冻结环境下自动回退到 ONNX 引擎
        import sys as _sys
        if getattr(_sys, 'frozen', False) and not args.engine.endswith('-onnx'):
            onnx_name = args.engine + '-onnx'
            logger.info(f"Primary engine failed, trying ONNX fallback: {onnx_name}")
            success, message = factory.initialize(onnx_name, config=engine_config)
        if not success:
            emit({"type": "error", "message": f"Failed to initialize engine: {message}"})
            sys.exit(1)

    engine = factory.get_engine()
    if engine is None:
        emit({"type": "error", "message": "Engine not available"})
        sys.exit(1)

    # 获取引擎能力
    capabilities = get_engine_capabilities(engine, bool(args.wake_word))

    # 预加载 VAD 模型（silero-vad 或能量阈值 fallback）
    vad = get_vad()
    vad_type = "silero" if vad._model_loaded else "energy_threshold"

    # 发送 ready 事件，包含能力声明
    emit({
        "type": "ready",
        "engine": args.engine,
        "capabilities": capabilities,
        "vad": vad_type,
        "wakeWord": bool(args.wake_word)
    })

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

            # 新增: init 命令处理
            if msg["type"] == "init":
                # 运行时配置更新（可选）
                config = msg.get("config", {})
                if config.get("engine") and config["engine"] != args.engine:
                    # TODO: 实现运行时引擎切换
                    emit({
                        "type": "info",
                        "message": f"Engine switch to {config['engine']} requested (not yet supported)"
                    })
                if config.get("language") and config["language"] != args.language:
                    args.language = config["language"]
                    emit({"type": "info", "message": f"Language changed to {config['language']}"})
                continue

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
                    result = engine.transcribe(audio, language=args.language)
                    if result.text:
                        emit({"type": "result", "text": result.text, "duration_ms": result.duration_ms})
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
