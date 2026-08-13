import numpy as np
import pytest
from stt_worker.vad import is_silence


def test_silence_detects_zeros():
    assert is_silence(np.zeros(16000, dtype="float32"))


def test_loud_noise_is_not_silence():
    rng = np.random.default_rng(42)
    audio = rng.standard_normal(16000).astype("float32") * 0.5
    assert not is_silence(audio)


def test_short_silence_less_than_200ms_is_ignored():
    # 200ms 以下静音不判静音（防误杀词间停顿）
    assert not is_silence(np.zeros(1600, dtype="float32"))


def test_very_short_loud_burst_is_noise_like():
    # 噪声突刺（< 150ms）能量高但时长不足 → 视为无有效语音
    rng = np.random.default_rng(7)
    burst = rng.standard_normal(1200).astype("float32") * 0.9
    from stt_worker.vad import has_voice
    assert not has_voice(burst)
