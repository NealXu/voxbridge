"""唤醒词检测模块。"""
import re


# 默认唤醒词
WAKE_WORD_DEFAULT = "你好小助"


def match_wake_word(text: str, wake_word: str = WAKE_WORD_DEFAULT) -> bool:
    """检查文本是否包含唤醒词。

    Args:
        text: 待检查的文本
        wake_word: 唤醒词短语，默认为"你好小助"

    Returns:
        如果文本包含唤醒词（忽略大小写和标点）返回 True，否则返回 False
    """
    if not text or not wake_word:
        return False

    # 统一转换为小写（对英文有效，中文无影响）
    text_lower = text.lower()
    wake_word_lower = wake_word.lower()

    # 移除常见标点符号和空白字符
    # 注意：这是简化版本，实际可能需要更复杂的标点处理
    import string
    # 创建一个包含中文标点和空格的字符集
    punctuation = "，。！？、；：""''（）《》【】" + string.whitespace
    text_clean = "".join(c for c in text_lower if c not in punctuation)
    wake_word_clean = "".join(c for c in wake_word_lower if c not in punctuation)

    # 检查是否包含唤醒词
    return wake_word_clean in text_clean