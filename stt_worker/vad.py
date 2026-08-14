"""基于 silero-vad 的端点检测：区分静音 / 噪声 / 有效语音。"""
import numpy as np
import onnxruntime as ort
from pathlib import Path
from typing import Optional
import urllib.request
import logging

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
SILENCE_RMS = 1e-4        # 低于此 RMS 视为静音（fallback用）
NOISE_MAX_RMS = 1e-2      # 超过此 RMS 且持续足够的时长才可能是有声（fallback用）
MIN_VOICE_MS = 200        # 有效语音最短持续时长

# silero-vad 模型配置
SILERO_MODEL_URL = "https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx"
SILERO_MODEL_FILENAME = "silero_vad.onnx"


def _download_model(model_path: Path) -> bool:
    """下载 silero-vad 模型。"""
    try:
        logger.info(f"Downloading silero-vad model to {model_path}")
        urllib.request.urlretrieve(SILERO_MODEL_URL, str(model_path))
        return True
    except Exception as e:
        logger.error(f"Failed to download model: {e}")
        return False


def rms(audio: np.ndarray) -> float:
    """计算音频的 RMS 能量。"""
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(audio**2)))


class SileroVAD:
    """silero-vad ONNX 模型封装。"""

    def __init__(self, model_path: Optional[Path] = None):
        """初始化 silero-vad 模型。

        Args:
            model_path: 模型文件路径。如果为 None，使用默认路径。
        """
        self.session: Optional[ort.InferenceSession] = None
        self._model_loaded = False

        # 尝试加载模型
        try:
            if model_path is None:
                # 默认路径：stt_worker/models/silero_vad.onnx
                model_path = Path(__file__).parent / "models" / SILERO_MODEL_FILENAME

            # 如果模型不存在，尝试下载
            if not model_path.exists():
                logger.warning(f"Model not found at {model_path}")
                model_path.parent.mkdir(parents=True, exist_ok=True)
                if not _download_model(model_path):
                    raise FileNotFoundError(f"Model not found at {model_path}")

            # 加载 ONNX 模型
            logger.info(f"Loading silero-vad model from {model_path}")
            self.session = ort.InferenceSession(
                str(model_path),
                providers=['CPUExecutionProvider']
            )
            self._model_loaded = True
            logger.info("Silero-vad model loaded successfully")

        except Exception as e:
            logger.warning(f"Failed to load silero-vad model: {e}. Falling back to energy threshold.")
            self.session = None
            self._model_loaded = False

    def is_speech(self, audio: np.ndarray, threshold: float = 0.5) -> bool:
        """检测音频是否包含语音。

        Args:
            audio: 音频数据（float32，16kHz）
            threshold: 语音检测阈值（0-1）

        Returns:
            True 如果检测到语音，False 否则
        """
        # 如果模型未加载，使用能量阈值 fallback
        if not self._model_loaded or self.session is None:
            return self._energy_based_detection(audio)

        try:
            # silero-vad 需要 512 样本的块（32ms @ 16kHz）
            # 对短音频特殊处理
            if len(audio) < 512:
                return False

            # 运行模型推理
            # silero-vad 输入：[batch, 512] float32
            # 输出：speech_prob
            audio_padded = audio.copy()
            if len(audio_padded) % 512 != 0:
                # 填充到 512 的整数倍
                pad_size = 512 - (len(audio_padded) % 512)
                audio_padded = np.pad(audio_padded, (0, pad_size), mode='constant')

            # 分块处理
            chunks = audio_padded.reshape(-1, 512)
            speech_probs = []

            # 初始化隐藏状态
            h = np.zeros(2, dtype=np.float32)
            c = np.zeros(2, dtype=np.float32)

            for chunk in chunks:
                # silero-vad 输入格式
                inputs = {
                    'input': chunk.reshape(1, -1).astype(np.float32),
                    'h': h.reshape(1, -1).astype(np.float32),
                    'c': c.reshape(1, -1).astype(np.float32),
                    'sr': np.array([SAMPLE_RATE], dtype=np.int64)
                }

                outputs = self.session.run(None, inputs)
                # outputs: [speech_prob, new_h, new_c]
                speech_prob = outputs[0][0]
                speech_probs.append(speech_prob)

                # 更新隐藏状态
                h = outputs[1][0]
                c = outputs[2][0]

            # 如果任何块的语音概率超过阈值，认为有语音
            max_prob = max(speech_probs) if speech_probs else 0
            return max_prob > threshold

        except Exception as e:
            logger.warning(f"VAD inference error: {e}. Using energy fallback.")
            return self._energy_based_detection(audio)

    def _energy_based_detection(self, audio: np.ndarray) -> bool:
        """基于能量的语音检测（fallback）。"""
        if audio.size < int(SAMPLE_RATE * MIN_VOICE_MS / 1000):
            return False
        return rms(audio) > NOISE_MAX_RMS


# 全局 VAD 实例（延迟初始化）
_vad_instance: Optional[SileroVAD] = None


def get_vad() -> SileroVAD:
    """获取全局 VAD 实例。"""
    global _vad_instance
    if _vad_instance is None:
        _vad_instance = SileroVAD()
    return _vad_instance


def is_silence(audio: np.ndarray) -> bool:
    """判断音频是否为静音。

    使用 silero-vad 检测，如果模型加载失败则回退到能量阈值。

    Args:
        audio: 音频数据（float32，16kHz）

    Returns:
        True 如果为静音，False 否则
    """
    # 使用 silero-vad 检测
    vad = get_vad()

    # silero-vad 判断语音
    # 如果检测到语音，则不是静音
    if vad.is_speech(audio):
        return False

    # 如果没有检测到语音，需要判断是静音还是短音频
    # 短音频（<200ms）不能判定为静音
    if audio.size < int(SAMPLE_RATE * MIN_VOICE_MS / 1000):
        return False

    # 能量极低才算静音
    return rms(audio) < SILENCE_RMS


def has_voice(audio: np.ndarray) -> bool:
    """判断音频是否包含有效语音。

    使用 silero-vad 检测，如果模型加载失败则回退到能量阈值。

    Args:
        audio: 音频数据（float32，16kHz）

    Returns:
        True 如果包含有效语音，False 否则
    """
    # 使用 silero-vad 检测
    vad = get_vad()

    # silero-vad 判断语音
    if vad.is_speech(audio):
        # 确保时长足够
        if audio.size >= int(SAMPLE_RATE * MIN_VOICE_MS / 1000):
            return True

    # fallback：能量阈值判断
    if audio.size < int(SAMPLE_RATE * MIN_VOICE_MS / 1000):
        return False
    return rms(audio) > NOISE_MAX_RMS