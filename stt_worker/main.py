"""STT worker 入口：读 stdin JSONL，控制录音与识别，写 stdout JSONL。"""
import argparse
import os
import sys

# 以脚本方式直接运行（python stt_worker/main.py）时 sys.path[0] 是脚本所在目录，
# 需将仓库根目录加入 sys.path，才能 import stt_worker.protocol。
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stt_worker.protocol import decode, encode


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
    args = parser.parse_args()

    # 骨架阶段：用占位实现，Task 6 替换为真实录音 + Whisper。
    emit({"type": "ready"})
    recording = False
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = decode(line)
        if msg["type"] == "start":
            recording = True
            emit({"type": "recording"})
        elif msg["type"] == "stop":
            recording = False
            emit({"type": "noise"})  # 占位：骨架阶段恒回 noise
        elif msg["type"] == "quit":
            break


if __name__ == "__main__":
    main()
