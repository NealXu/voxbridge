import io
from unittest import mock

from stt_worker import main


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
    with mock.patch.object(main.sys, "stdin", in_buf), \
         mock.patch.object(main.sys, "stdout", out), \
         mock.patch.object(main.sys, "argv", worker_argv):
        main.main()
    lines = out.getvalue().strip().splitlines()
    assert lines[0] == '{"type": "ready"}'
    assert any("noise" in l for l in lines)
