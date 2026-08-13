"""基于能量的端点检测：区分静音 / 噪声 / 有效语音。"""
import numpy as np

SAMPLE_RATE = 16000
SILENCE_RMS = 1e-4        # 低于此 RMS 视为静音
NOISE_MAX_RMS = 1e-2      # 超过此 RMS 且持续足够的时长才可能是有声
MIN_VOICE_MS = 200        # 有效语音最短持续时长


def rms(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(audio**2)))


def is_silence(audio: np.ndarray) -> bool:
    """能量低于阈值且时长足够长（>=200ms）才算静音。"""
    if audio.size < int(SAMPLE_RATE * MIN_VOICE_MS / 1000):
        return False
    return rms(audio) < SILENCE_RMS


def has_voice(audio: np.ndarray) -> bool:
    """能量高于噪声上限且时长足够。"""
    if audio.size < int(SAMPLE_RATE * MIN_VOICE_MS / 1000):
        return False
    return rms(audio) > NOISE_MAX_RMS
