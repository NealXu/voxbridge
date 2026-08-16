"""
跨语言协议兼容性测试
验证 TypeScript 和 Python 之间的协议编解码一致性
"""
import json
from stt_worker.protocol import (
    CommandType,
    EventType,
    WorkerCapabilities,
    encode_event,
    decode_command,
)


def test_typescript_python_init_command_compatibility():
    """验证 init 命令在 TS 和 Python 之间的兼容性"""
    # TypeScript 端生成的 init 命令
    ts_encoded = '{"type":"init","config":{"engine":"whisper","language":"zh","modelDir":"/models/whisper","vad":{"threshold":0.5,"minVoiceMs":300},"wakeWord":{"enabled":true,"phrase":"你好小助手"}}}\n'

    # Python 端解码
    decoded = decode_command(ts_encoded)

    assert decoded["type"] == "init"
    assert decoded["config"]["engine"] == "whisper"
    assert decoded["config"]["language"] == "zh"
    assert decoded["config"]["vad"]["threshold"] == 0.5
    assert decoded["config"]["wakeWord"]["phrase"] == "你好小助手"


def test_typescript_python_ready_event_compatibility():
    """验证 ready 事件在 TS 和 Python 之间的兼容性"""
    # Python 端生成的 ready 事件
    caps = WorkerCapabilities(
        streaming=True,
        wake_word=False,
        languages=["zh", "en"],
        confidence=True,
        word_timestamps=True,
    )
    py_encoded = encode_event(EventType.READY, engine="whisper", capabilities=caps)

    # 模拟 TypeScript 端解析
    data = json.loads(py_encoded)

    assert data["type"] == "ready"
    assert data["engine"] == "whisper"
    assert data["capabilities"]["streaming"] is True
    assert data["capabilities"]["languages"] == ["zh", "en"]


def test_typescript_python_result_event_compatibility():
    """验证 result 事件在 TS 和 Python 之间的兼容性"""
    # Python 端生成的 result 事件
    py_encoded = encode_event(
        EventType.RESULT,
        text="你好世界",
        duration_ms=1200,
        is_final=True,
    )

    # 模拟 TypeScript 端解析
    data = json.loads(py_encoded)

    assert data["type"] == "result"
    assert data["text"] == "你好世界"
    assert data["duration_ms"] == 1200
    assert data["is_final"] is True


def test_typescript_python_error_event_compatibility():
    """验证 error 事件在 TS 和 Python 之间的兼容性"""
    # Python 端生成的 error 事件
    py_encoded = encode_event(
        EventType.ERROR,
        code="E001",
        message="未检测到音频输入设备",
        recoverable=False,
    )

    # 模拟 TypeScript 端解析
    data = json.loads(py_encoded)

    assert data["type"] == "error"
    assert data["code"] == "E001"
    assert data["message"] == "未检测到音频输入设备"
    assert data["recoverable"] is False


def test_chinese_encoding_compatibility():
    """验证中文编码在 TS 和 Python 之间的兼容性"""
    # Python 端编码包含中文的事件
    py_encoded = encode_event(
        EventType.RESULT,
        text="你好世界",
        duration_ms=1000,
    )

    # 验证中文不被转义
    assert "你好世界" in py_encoded
    assert "\\u" not in py_encoded

    # 模拟 TypeScript 端解析（应该正确解码中文）
    data = json.loads(py_encoded)
    assert data["text"] == "你好世界"


if __name__ == "__main__":
    print("Running cross-language protocol compatibility tests...\n")

    test_typescript_python_init_command_compatibility()
    print("✓ init 命令兼容性测试通过")

    test_typescript_python_ready_event_compatibility()
    print("✓ ready 事件兼容性测试通过")

    test_typescript_python_result_event_compatibility()
    print("✓ result 事件兼容性测试通过")

    test_typescript_python_error_event_compatibility()
    print("✓ error 事件兼容性测试通过")

    test_chinese_encoding_compatibility()
    print("✓ 中文编码兼容性测试通过")

    print("\n所有跨语言协议兼容性测试通过！")