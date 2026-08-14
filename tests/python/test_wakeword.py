"""唤醒词匹配函数测试。"""
import pytest
from stt_worker.wakeword import match_wake_word, WAKE_WORD_DEFAULT


def test_match_wake_word_default():
    """默认唤醒词'你好小助'应能匹配。"""
    assert match_wake_word("你好小助") is True
    assert match_wake_word("你好，小助") is True  # 允许标点
    assert match_wake_word("你好小助，今天天气怎么样") is True  # 前缀匹配
    assert match_wake_word("那个，你好小助") is True  # 包含匹配


def test_match_wake_word_custom():
    """自定义唤醒词应能匹配。"""
    assert match_wake_word("小助手", wake_word="小助手") is True
    assert match_wake_word("嘿小助手", wake_word="小助手") is True
    assert match_wake_word("小助手你好", wake_word="小助手") is True


def test_no_match_wake_word():
    """不包含唤醒词应返回 False。"""
    assert match_wake_word("今天天气怎么样") is False
    assert match_wake_word("你好世界") is False
    assert match_wake_word("") is False


def test_wake_word_case_insensitive():
    """英文唤醒词应不区分大小写（如果支持）。"""
    # 中文默认不区分大小写，英文需要
    assert match_wake_word("HELLO", wake_word="hello") is True
    assert match_wake_word("Hello", wake_word="hello") is True


def test_wake_word_punctuation_tolerance():
    """唤醒词匹配应容忍标点符号。"""
    assert match_wake_word("你好，小助！") is True
    assert match_wake_word("你好小助。") is True
    assert match_wake_word("你好！小助") is True


def test_default_wake_word_constant():
    """默认唤醒词常量应与代码一致。"""
    assert WAKE_WORD_DEFAULT == "你好小助"