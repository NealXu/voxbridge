"""stdio JSONL 编解码。"""
import json


def encode(msg: dict) -> str:
    """序列化为单行 JSON + 换行，ensure_ascii=False 保证中文可读。"""
    return json.dumps(msg, ensure_ascii=False) + "\n"


def decode(line: str) -> dict:
    """解析一行 JSON。非法输入抛 ValueError。"""
    try:
        return json.loads(line)
    except json.JSONDecodeError as e:
        raise ValueError(f"bad JSONL: {line!r}") from e
