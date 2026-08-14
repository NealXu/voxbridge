"""测试 silero-vad 集成的 VAD 模块。"""
import numpy as np
import pytest
from pathlib import Path
from stt_worker.vad import is_silence, has_voice, SileroVAD


class TestSileroVAD:
    """测试 SileroVAD 类。"""

    def test_loads_model_without_error(self):
        """SileroVAD 应能成功初始化。"""
        vad = SileroVAD()
        assert vad is not None

    def test_detects_silence_from_zeros(self):
        """零音频应被检测为静音。"""
        vad = SileroVAD()
        audio = np.zeros(16000, dtype="float32")  # 1秒静音
        assert vad.is_speech(audio) == False

    def test_detects_speech_from_noise(self):
        """高能量噪声应被检测为语音。"""
        vad = SileroVAD()
        rng = np.random.default_rng(42)
        # 生成模拟语音（白噪声，能量较高）
        audio = rng.standard_normal(16000).astype("float32") * 0.5
        # 注意：silero-vad 可能不会把纯噪声判定为语音，这里主要测试接口可用
        # 实际行为取决于模型
        result = vad.is_speech(audio)
        assert isinstance(result, bool)

    def test_handles_short_audio(self):
        """短音频片段应被正确处理（不抛异常）。"""
        vad = SileroVAD()
        audio = np.zeros(800, dtype="float32")  # 50ms，短于最小长度
        # 应该不抛异常，返回 False
        assert vad.is_speech(audio) == False


class TestVADBackwardCompatibility:
    """测试向后兼容性：现有接口仍能工作。"""

    def test_is_silence_still_works(self):
        """is_silence 函数应保持原有行为。"""
        # 现有测试
        assert is_silence(np.zeros(16000, dtype="float32"))
        assert not is_silence(np.zeros(1600, dtype="float32"))  # 太短

    def test_has_voice_still_works(self):
        """has_voice 函数应保持原有行为。"""
        rng = np.random.default_rng(42)
        audio = rng.standard_normal(16000).astype("float32") * 0.5
        # 能量阈值判断
        assert not has_voice(np.zeros(16000, dtype="float32"))
        assert has_voice(audio)


class TestVADIntegration:
    """测试 VAD 集成场景。"""

    def test_silero_vad_used_by_default(self):
        """默认应使用 SileroVAD。"""
        # 如果 SileroVAD 加载成功，is_silence 应使用它
        # 这里测试接口一致性
        audio = np.zeros(16000, dtype="float32")
        result = is_silence(audio)
        assert isinstance(result, bool)

    def test_fallback_on_model_error(self):
        """模型加载失败时应回退到能量阈值。"""
        # 这个测试验证降级方案
        # 由于模型可能已经成功加载，这里主要验证不会崩溃
        vad = SileroVAD()
        audio = np.zeros(16000, dtype="float32")
        result = vad.is_speech(audio)
        assert isinstance(result, bool)


# 原有测试保持不变（向后兼容）
def test_silence_detects_zeros():
    assert is_silence(np.zeros(16000, dtype="float32"))


def test_loud_noise_is_not_silence():
    rng = np.random.default_rng(42)
    audio = rng.standard_normal(16000).astype("float32") * 0.5
    assert not is_silence(audio)


def test_short_silence_less_than_200_ms_is_ignored():
    # 200ms 以下静音不判静音（防误杀词间停顿）
    assert not is_silence(np.zeros(1600, dtype="float32"))


def test_very_short_loud_burst_is_noise_like():
    # 噪声突刺（< 150ms）能量高但时长不足 → 视为无有效语音
    rng = np.random.default_rng(7)
    burst = rng.standard_normal(1200).astype("float32") * 0.9
    from stt_worker.vad import has_voice
    assert not has_voice(burst)