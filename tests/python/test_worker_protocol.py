import io
from unittest import mock

import numpy as np

from stt_worker import main
from stt_worker.engines.base import TranscriptionResult


def test_ready_then_noise_on_stop():
    in_buf = io.StringIO('{"type": "start"}\n{"type": "stop"}\n{"type": "quit"}\n')
    out = io.StringIO()
    # 模拟 Node 端实际 spawn 参数（见 task brief argv: --model/--model-dir/--language），
    # 避免 argparse 读到 pytest 自身的 sys.argv。
    worker_argv = [
        "stt_worker/main.py",
        "--model", "large-v3",
        "--model-dir", r"D:\Models\faster-whisper-large-v3",
        "--language", "zh",
    ]
    # 单元测试只验证协议编排：mock 掉 2.9GB 模型加载与真实麦克风，
    # 真实模型/麦克风由 integration 测试与手动冒烟覆盖。
    fake_engine = mock.MagicMock()
    fake_engine.transcribe.return_value = TranscriptionResult(text="", duration_ms=0)
    fake_engine.load.return_value = True
    fake_factory = mock.MagicMock()
    fake_factory.initialize.return_value = (True, "success")
    fake_factory.get_engine.return_value = fake_engine
    fake_recorder = mock.MagicMock()
    fake_recorder.stop.return_value = np.zeros(0, dtype="float32")
    with mock.patch("stt_worker.main.EngineFactory", return_value=fake_factory), \
         mock.patch("stt_worker.main.EngineRegistry"), \
         mock.patch.object(main, "Recorder", return_value=fake_recorder), \
         mock.patch.object(main.sys, "stdin", in_buf), \
         mock.patch.object(main.sys, "stdout", out), \
         mock.patch.object(main.sys, "argv", worker_argv):
        main.main()
    lines = out.getvalue().strip().splitlines()
    # ready 消息包含 VAD 类型信息（silero 或 energy_threshold）
    assert '"type": "ready"' in lines[0]
    assert any("noise" in l for l in lines)


def _run_worker(lines, fake_engine, fake_recorder):
    in_buf = io.StringIO(lines)
    out = io.StringIO()
    worker_argv = [
        "stt_worker/main.py",
        "--model", "large-v3",
        "--model-dir", r"D:\Models\faster-whisper-large-v3",
        "--language", "zh",
    ]
    fake_factory = mock.MagicMock()
    fake_factory.initialize.return_value = (True, "success")
    fake_factory.get_engine.return_value = fake_engine
    with mock.patch("stt_worker.main.EngineFactory", return_value=fake_factory), \
         mock.patch("stt_worker.main.EngineRegistry"), \
         mock.patch.object(main, "Recorder", return_value=fake_recorder), \
         mock.patch.object(main.sys, "stdin", in_buf), \
         mock.patch.object(main.sys, "stdout", out), \
         mock.patch.object(main.sys, "argv", worker_argv):
        main.main()
    return out.getvalue().strip().splitlines()


def test_transcribe_error_emits_error_not_crash():
    fake_engine = mock.MagicMock()
    fake_engine.transcribe.side_effect = RuntimeError("boom")
    fake_recorder = mock.MagicMock()
    # 有语音（rms 0.5 > NOISE_MAX_RMS），确保走到 transcribe 分支。
    fake_recorder.stop.return_value = np.full(32000, 0.5, dtype="float32")
    lines = _run_worker(
        '{"type": "start"}\n{"type": "stop"}\n{"type": "quit"}\n',
        fake_engine, fake_recorder,
    )
    # ready 消息包含 VAD 类型信息（silero 或 energy_threshold）
    assert '"type": "ready"' in lines[0]
    # 转写抛异常 → 发 error，而不是让 worker 崩溃。
    assert '{"type": "error", "message": "boom"}' in lines


def test_double_start_closes_previous_recorder():
    fake_engine = mock.MagicMock()
    fake_recorder = mock.MagicMock()
    fake_recorder.stop.return_value = np.zeros(0, dtype="float32")
    lines = _run_worker(
        '{"type": "start"}\n{"type": "start"}\n{"type": "stop"}\n{"type": "quit"}\n',
        fake_engine, fake_recorder,
    )
    # 两次 start：double-start guard 先关掉旧录音，stop 分支再关第二次 → stop 共 2 次。
    assert fake_recorder.start.call_count == 2
    assert fake_recorder.stop.call_count == 2
    assert '{"type": "recording"}' in lines


def test_emit_pipe_output_is_utf8():
    # 模拟 Windows 管道：TextIOWrapper 默认按 locale 编码（中文系统 cp936/gbk）。
    # 若 _force_utf8 未生效，中文会被写成 gbk 字节，按 UTF-8 解码会失败。
    raw = io.BytesIO()
    pipe_out = io.TextIOWrapper(raw, encoding="gbk")
    with mock.patch.object(main.sys, "stdout", pipe_out):
        main._force_utf8(pipe_out)
        main.emit({"type": "result", "text": "你好", "duration_ms": 1})
    pipe_out.flush()
    assert raw.getvalue().decode("utf-8") == \
        '{"type": "result", "text": "你好", "duration_ms": 1}\n'
