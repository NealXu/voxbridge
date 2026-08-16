"""
Worker 协议增强测试 (TDD Green Phase)
测试 Python 端的协议编解码功能
"""
import pytest
import json
from stt_worker.protocol import (
    CommandType,
    EventType,
    WorkerCapabilities,
    encode_event,
    decode_command,
)


class TestCommandType:
    """命令类型枚举测试"""

    def test_command_types(self):
        """验证所有命令类型"""
        assert CommandType.INIT.value == "init"
        assert CommandType.START.value == "start"
        assert CommandType.STOP.value == "stop"
        assert CommandType.CANCEL.value == "cancel"
        assert CommandType.QUIT.value == "quit"


class TestEventType:
    """事件类型枚举测试"""

    def test_event_types(self):
        """验证所有事件类型"""
        assert EventType.READY.value == "ready"
        assert EventType.RECORDING.value == "recording"
        assert EventType.RESULT.value == "result"
        assert EventType.PARTIAL.value == "partial"
        assert EventType.NOISE.value == "noise"
        assert EventType.ERROR.value == "error"
        assert EventType.DOWNLOADING.value == "downloading"
        assert EventType.WAKE.value == "wake"


class TestWorkerCapabilities:
    """Worker 能力数据类测试"""

    def test_default_values(self):
        """验证默认值"""
        caps = WorkerCapabilities()
        assert caps.streaming is False
        assert caps.wake_word is False
        assert caps.languages == ["zh"]
        assert caps.confidence is False
        assert caps.word_timestamps is False

    def test_custom_values(self):
        """验证自定义值"""
        caps = WorkerCapabilities(
            streaming=True,
            wake_word=True,
            languages=["zh", "en", "ja"],
            confidence=True,
            word_timestamps=True,
        )
        assert caps.streaming is True
        assert caps.wake_word is True
        assert caps.languages == ["zh", "en", "ja"]
        assert caps.confidence is True
        assert caps.word_timestamps is True

    def test_to_dict(self):
        """验证序列化为字典"""
        caps = WorkerCapabilities(streaming=True, languages=["en"])
        result = caps.to_dict()
        expected = {
            "streaming": True,
            "wake_word": False,
            "languages": ["en"],
            "confidence": False,
            "word_timestamps": False,
        }
        assert result == expected


class TestEncodeEvent:
    """事件编码测试"""

    def test_encode_ready_event(self):
        """编码 ready 事件"""
        caps = WorkerCapabilities(streaming=True)
        result = encode_event(EventType.READY, engine="whisper", capabilities=caps)
        data = json.loads(result)

        assert data["type"] == "ready"
        assert data["engine"] == "whisper"
        assert data["capabilities"]["streaming"] is True

    def test_encode_result_event(self):
        """编码 result 事件"""
        result = encode_event(
            EventType.RESULT,
            text="你好世界",
            duration_ms=1200,
        )
        data = json.loads(result)

        assert data["type"] == "result"
        assert data["text"] == "你好世界"
        assert data["duration_ms"] == 1200

    def test_encode_result_event_with_is_final(self):
        """编码 result 事件包含 is_final"""
        result = encode_event(
            EventType.RESULT,
            text="你好",
            duration_ms=500,
            is_final=False,
        )
        data = json.loads(result)

        assert data["is_final"] is False

    def test_encode_partial_event(self):
        """编码 partial 事件"""
        result = encode_event(EventType.PARTIAL, text="你好")
        data = json.loads(result)

        assert data == {"type": "partial", "text": "你好"}

    def test_encode_error_event(self):
        """编码 error 事件"""
        result = encode_event(
            EventType.ERROR,
            code="E001",
            message="未检测到音频输入设备",
            recoverable=False,
        )
        data = json.loads(result)

        assert data["type"] == "error"
        assert data["code"] == "E001"
        assert data["message"] == "未检测到音频输入设备"
        assert data["recoverable"] is False

    def test_encode_error_event_without_code(self):
        """编码 error 事件不含 code"""
        result = encode_event(
            EventType.ERROR,
            message="错误",
            recoverable=True,
        )
        data = json.loads(result)

        assert "code" not in data or data.get("code") is None
        assert data["recoverable"] is True

    def test_encode_downloading_event(self):
        """编码 downloading 事件"""
        result = encode_event(
            EventType.DOWNLOADING,
            progress=0.75,
            message="下载模型文件 75%",
        )
        data = json.loads(result)

        assert data["progress"] == 0.75
        assert data["message"] == "下载模型文件 75%"

    def test_encode_wake_event(self):
        """编码 wake 事件"""
        result = encode_event(
            EventType.WAKE,
            phrase="你好小助手",
            heard="你好小树",
        )
        data = json.loads(result)

        assert data["phrase"] == "你好小助手"
        assert data["heard"] == "你好小树"

    def test_encode_returns_newline_terminated(self):
        """验证返回值以换行结尾"""
        result = encode_event(EventType.NOISE)
        assert result.endswith("\n")

    def test_encode_chinese_not_escaped(self):
        """验证中文不被转义"""
        result = encode_event(EventType.RESULT, text="你好世界", duration_ms=100)
        assert "你好世界" in result
        assert "\\u" not in result


class TestDecodeCommand:
    """命令解码测试"""

    def test_decode_init_command(self):
        """解码 init 命令"""
        line = json.dumps({
            "type": "init",
            "config": {
                "engine": "whisper",
                "language": "zh",
                "modelDir": "/models",
            },
        })
        result = decode_command(line)

        assert result["type"] == "init"
        assert result["config"]["engine"] == "whisper"
        assert result["config"]["language"] == "zh"

    def test_decode_start_command(self):
        """解码 start 命令"""
        line = '{"type":"start"}'
        result = decode_command(line)

        assert result == {"type": "start"}

    def test_decode_stop_command(self):
        """解码 stop 命令"""
        line = '{"type":"stop"}'
        result = decode_command(line)

        assert result == {"type": "stop"}

    def test_decode_cancel_command(self):
        """解码 cancel 命令"""
        line = '{"type":"cancel"}'
        result = decode_command(line)

        assert result == {"type": "cancel"}

    def test_decode_quit_command(self):
        """解码 quit 命令"""
        line = '{"type":"quit"}'
        result = decode_command(line)

        assert result == {"type": "quit"}

    def test_decode_init_with_vad_config(self):
        """解码包含 VAD 配置的 init 命令"""
        line = json.dumps({
            "type": "init",
            "config": {
                "engine": "whisper",
                "language": "zh",
                "vad": {
                    "threshold": 0.5,
                    "minVoiceMs": 300,
                    "silenceRms": 0.01,
                },
            },
        })
        result = decode_command(line)

        assert result["config"]["vad"]["threshold"] == 0.5
        assert result["config"]["vad"]["minVoiceMs"] == 300

    def test_decode_init_with_wake_word(self):
        """解码包含唤醒词配置的 init 命令"""
        line = json.dumps({
            "type": "init",
            "config": {
                "engine": "whisper",
                "language": "zh",
                "wakeWord": {
                    "enabled": True,
                    "phrase": "你好小助手",
                },
            },
        })
        result = decode_command(line)

        assert result["config"]["wakeWord"]["enabled"] is True
        assert result["config"]["wakeWord"]["phrase"] == "你好小助手"

    def test_decode_invalid_json_raises(self):
        """非法 JSON 应抛出 ValueError"""
        with pytest.raises(ValueError):
            decode_command("{not json}")


class TestBackwardCompatibility:
    """向后兼容性测试"""

    def test_old_protocol_still_works(self):
        """旧协议仍然有效"""
        from stt_worker.protocol import encode, decode

        # 旧的编码方式
        result = encode({"type": "result", "text": "测试", "duration_ms": 500})
        assert "测试" in result

        # 旧的解码方式
        cmd = decode('{"type":"start"}')
        assert cmd == {"type": "start"}

    def test_new_protocol_compatible_with_old_format(self):
        """新协议兼容旧格式"""
        # 新协议的 encode_event 应该能编码旧事件
        result = encode_event(EventType.RECORDING)
        data = json.loads(result)
        assert data == {"type": "recording"}