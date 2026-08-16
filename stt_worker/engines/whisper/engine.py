"""Whisper engine implementation using faster-whisper."""
import time
from typing import Dict, Any, Tuple

import numpy as np

from ..base import EngineBase, EngineInfo, TranscriptionResult, EngineState


class WhisperEngine(EngineBase):
    """Whisper engine using faster-whisper library.

    This is a refactored version of the original WhisperEngine that
    implements the EngineBase interface.
    """

    def __init__(self, config: Dict[str, Any]):
        """Initialize Whisper engine.

        Args:
            config: Configuration dictionary with keys:
                - model_dir: Path to model directory
                - device: Device to use (cpu, cuda, auto)
                - compute_type: Compute type (int8, float16, float32)
                - language: Default language code
        """
        super().__init__(config)
        self._model = None
        self.model_dir = config.get("model_dir", r"D:\Models\faster-whisper-large-v3")
        self.device = config.get("device", "cpu")
        self.compute_type = config.get("compute_type", "int8")
        self.language = config.get("language", "zh")

    @classmethod
    def get_info(cls) -> EngineInfo:
        """Return engine metadata."""
        return EngineInfo(
            name="whisper",
            version="1.0.0",
            description="Whisper ASR engine using faster-whisper",
            supported_languages=["zh", "en", "ja", "ko", "de", "fr", "es", "ru", "auto"],
            supports_streaming=False,
            requires_gpu=False,
            supports_confidence=False,
            supports_word_timestamps=True,
        )

    @classmethod
    def get_default_config(cls) -> Dict[str, Any]:
        """Return default configuration."""
        return {
            "model_dir": r"D:\Models\faster-whisper-large-v3",
            "device": "cpu",
            "compute_type": "int8",
            "language": "zh",
        }

    def load(self) -> bool:
        """Load the Whisper model.

        This may take several seconds and consume several GB of memory.

        Returns:
            True if loaded successfully
        """
        self._state = EngineState.LOADING

        try:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_dir,
                device=self.device,
                compute_type=self.compute_type
            )
            self._state = EngineState.READY
            return True

        except Exception as e:
            self._set_error(f"Failed to load model: {e}")
            return False

    def unload(self) -> None:
        """Unload the model and free resources."""
        if self._model is not None:
            # faster-whisper doesn't have explicit unload, so we just dereference
            self._model = None
        self._state = EngineState.UNINITIALIZED

    def transcribe(
        self,
        audio: np.ndarray,
        language: str = "zh",
        **kwargs
    ) -> TranscriptionResult:
        """Transcribe audio using Whisper.

        Args:
            audio: Audio samples as numpy array (float32, 16kHz)
            language: Language code (e.g., "zh", "en")
            **kwargs: Additional parameters passed to faster-whisper

        Returns:
            TranscriptionResult with transcription

        Raises:
            RuntimeError: If engine is not ready
        """
        if not self.is_ready():
            raise RuntimeError("WhisperEngine.load() must be called first")

        if self._model is None:
            raise RuntimeError("Model not loaded")

        start = time.monotonic()

        try:
            # Transcribe with VAD filter
            segments, info = self._model.transcribe(
                audio,
                language=language,
                vad_filter=True,
                **kwargs
            )

            # Collect segments
            segment_list = []
            text_parts = []
            for seg in segments:
                text_parts.append(seg.text)
                segment_list.append({
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text,
                })

            text = "".join(text_parts).strip()
            duration_ms = int((time.monotonic() - start) * 1000)

            return TranscriptionResult(
                text=text,
                duration_ms=duration_ms,
                language=language,
                segments=segment_list,
            )

        except Exception as e:
            raise RuntimeError(f"Transcription failed: {e}") from e