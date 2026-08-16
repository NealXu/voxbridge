"""stdio JSONL 编解码。"""
from enum import Enum
from dataclasses import dataclass, field, asdict
from typing import Dict, Any, List, Optional, Union
import json


class CommandType(Enum):
    """命令类型"""
    INIT = "init"
    START = "start"
    STOP = "stop"
    CANCEL = "cancel"
    QUIT = "quit"


class EventType(Enum):
    """事件类型"""
    READY = "ready"
    RECORDING = "recording"
    RESULT = "result"
    PARTIAL = "partial"
    NOISE = "noise"
    ERROR = "error"
    DOWNLOADING = "downloading"
    WAKE = "wake"


@dataclass
class WorkerCapabilities:
    """Worker 能力声明"""
    streaming: bool = False
    wake_word: bool = False
    languages: List[str] = field(default_factory=lambda: ["zh"])
    confidence: bool = False
    word_timestamps: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return asdict(self)


@dataclass
class WorkerConfig:
    """Worker 配置"""
    engine: str = "whisper"
    language: str = "zh"
    model_dir: Optional[str] = None
    model: Optional[str] = None
    vad: Optional[Dict[str, Any]] = None
    wake_word: Optional[Dict[str, Any]] = None
    engine_options: Optional[Dict[str, Any]] = None


def encode_event(event_type: Union[EventType, str], **kwargs) -> str:
    """编码事件为 JSONL

    Args:
        event_type: 事件类型（枚举或字符串）
        **kwargs: 事件数据

    Returns:
        JSONL 格式的字符串
    """
    if isinstance(event_type, EventType):
        type_str = event_type.value
    else:
        type_str = event_type

    data = {"type": type_str, **kwargs}

    # 处理 dataclass 对象
    for key, value in list(data.items()):
        if hasattr(value, "to_dict"):
            data[key] = value.to_dict()
        elif hasattr(value, "__dataclass_fields__"):
            data[key] = asdict(value)

    return json.dumps(data, ensure_ascii=False) + "\n"


def decode_command(line: str) -> Dict[str, Any]:
    """解码 JSONL 命令

    Args:
        line: JSONL 格式的命令行

    Returns:
        解析后的字典

    Raises:
        ValueError: JSON 解析失败
    """
    try:
        return json.loads(line.strip())
    except json.JSONDecodeError as e:
        raise ValueError(f"bad JSONL: {line!r}") from e


def encode(msg: dict) -> str:
    """序列化为单行 JSON + 换行，ensure_ascii=False 保证中文可读。

    保持向后兼容，同时支持包含 dataclass 的消息。
    """
    # 处理包含 dataclass 的消息
    processed = {}
    for key, value in msg.items():
        if hasattr(value, "to_dict"):
            processed[key] = value.to_dict()
        elif hasattr(value, "__dataclass_fields__"):
            processed[key] = asdict(value)
        else:
            processed[key] = value
    return json.dumps(processed, ensure_ascii=False) + "\n"


def decode(line: str) -> dict:
    """解析一行 JSON。非法输入抛 ValueError。"""
    try:
        return json.loads(line.strip())
    except json.JSONDecodeError as e:
        raise ValueError(f"bad JSONL: {line!r}") from e
