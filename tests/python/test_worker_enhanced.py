"""测试增强后的 worker 功能"""
import json
import pytest
from stt_worker.protocol import encode, decode, EventType, WorkerCapabilities, encode_event, decode_command


def test_encode_ready_with_capabilities():
    """测试 ready 事件包含 capabilities"""
    capabilities = WorkerCapabilities(
        streaming=True,
        wake_word=True,
        languages=["zh", "en"],
        confidence=True,
        word_timestamps=False
    )
    event = encode({
        "type": "ready",
        "engine": "sensevoice",
        "capabilities": capabilities
    })
    data = json.loads(event)
    assert data["type"] == "ready"
    assert data["engine"] == "sensevoice"
    assert data["capabilities"]["streaming"] == True
    assert data["capabilities"]["languages"] == ["zh", "en"]


def test_encode_partial_result():
    """测试 partial 结果事件"""
    event = encode({"type": "partial", "text": "你好"})
    data = json.loads(event)
    assert data["type"] == "partial"
    assert data["text"] == "你好"


def test_decode_init_command():
    """测试 init 命令解析"""
    line = '{"type": "init", "config": {"engine": "sensevoice", "language": "zh"}}'
    cmd = decode(line)
    assert cmd["type"] == "init"
    assert cmd["config"]["engine"] == "sensevoice"


def test_worker_capabilities_to_dict():
    """测试 WorkerCapabilities 转换为字典"""
    capabilities = WorkerCapabilities(
        streaming=True,
        wake_word=False,
        languages=["zh", "en", "ja"],
        confidence=True,
        word_timestamps=True
    )
    result = capabilities.to_dict()
    assert result["streaming"] == True
    assert result["wake_word"] == False
    assert result["languages"] == ["zh", "en", "ja"]
    assert result["confidence"] == True
    assert result["word_timestamps"] == True


def test_worker_capabilities_defaults():
    """测试 WorkerCapabilities 默认值"""
    capabilities = WorkerCapabilities()
    assert capabilities.streaming == False
    assert capabilities.wake_word == False
    assert capabilities.languages == ["zh"]
    assert capabilities.confidence == False
    assert capabilities.word_timestamps == False


def test_encode_event_with_enum():
    """测试使用 EventType 枚举编码事件"""
    event = encode_event(EventType.READY, engine="whisper", status="ok")
    data = json.loads(event)
    assert data["type"] == "ready"
    assert data["engine"] == "whisper"
    assert data["status"] == "ok"


def test_encode_event_with_string():
    """测试使用字符串编码事件"""
    event = encode_event("result", text="测试文本", duration_ms=1500)
    data = json.loads(event)
    assert data["type"] == "result"
    assert data["text"] == "测试文本"
    assert data["duration_ms"] == 1500


def test_encode_event_with_dataclass():
    """测试编码包含 dataclass 的事件"""
    capabilities = WorkerCapabilities(streaming=True, languages=["en"])
    event = encode_event(EventType.READY, capabilities=capabilities)
    data = json.loads(event)
    assert data["type"] == "ready"
    assert data["capabilities"]["streaming"] == True
    assert data["capabilities"]["languages"] == ["en"]


def test_decode_command():
    """测试解码命令"""
    line = '{"type": "start", "timeout": 5000}\n'
    cmd = decode_command(line)
    assert cmd["type"] == "start"
    assert cmd["timeout"] == 5000


def test_event_type_enum():
    """测试 EventType 枚举值"""
    assert EventType.READY.value == "ready"
    assert EventType.RECORDING.value == "recording"
    assert EventType.RESULT.value == "result"
    assert EventType.PARTIAL.value == "partial"
    assert EventType.ERROR.value == "error"


def test_backward_compatibility():
    """测试向后兼容性"""
    # 旧的 encode/decode 函数应该仍然工作
    msg = {"type": "result", "text": "测试", "duration_ms": 1000}
    encoded = encode(msg)
    decoded = decode(encoded)

    assert decoded["type"] == "result"
    assert decoded["text"] == "测试"
    assert decoded["duration_ms"] == 1000