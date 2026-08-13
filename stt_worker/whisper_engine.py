"""faster-whisper 封装：一次性加载模型，逐次转写。"""
import time
from typing import Tuple

import numpy as np
from faster_whisper import WhisperModel


class WhisperEngine:
    def __init__(self, model_dir: str, device: str = "cpu", compute_type: str = "int8"):
        self._model: WhisperModel | None = None
        self.model_dir = model_dir
        self.device = device
        self.compute_type = compute_type

    def load(self) -> None:
        """加载模型（首次会占用数秒与数 GB 内存，只调一次）。"""
        self._model = WhisperModel(
            self.model_dir, device=self.device, compute_type=self.compute_type
        )

    def transcribe(self, audio: np.ndarray, language: str = "zh") -> Tuple[str, int]:
        """转写音频，返回 (文本, 时长毫秒)。无语音返回 ("", 0)。"""
        if self._model is None:
            raise RuntimeError("WhisperEngine.load() must be called first")
        start = time.monotonic()
        segments, _ = self._model.transcribe(audio, language=language, vad_filter=True)
        text = "".join(seg.text for seg in segments).strip()
        return text, int((time.monotonic() - start) * 1000)
