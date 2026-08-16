"""SenseVoice engine implementation via FunASR."""
import time
import numpy as np
from typing import Dict, Any, Optional

from ..base import EngineBase, EngineInfo, EngineState, TranscriptionResult


class SenseVoiceEngine(EngineBase):
    """SenseVoice ASR engine using FunASR SDK.

    Advantages over Whisper:
    - 10x faster on CPU (RTF 0.03-0.05 vs 0.5-1.0)
    - Better Chinese accuracy
    - Built-in ITN (numbers), emotion detection, sound events
    - Smaller model (230MB vs 3GB)
    """

    @classmethod
    def get_info(cls) -> EngineInfo:
        """Return engine metadata."""
        return EngineInfo(
            name="sensevoice",
            version="1.0.0",
            description="Alibaba SenseVoice via FunASR",
            supported_languages=["zh", "en", "ja", "ko", "yue"],
            supports_streaming=False,
            requires_gpu=False,
            supports_confidence=True,
        )

    @classmethod
    def get_default_config(cls) -> Dict[str, Any]:
        """Return default configuration."""
        return {
            "model_path": "iic/SenseVoiceSmall",
            "device": "cpu",
            "use_itn": True,
        }

    def __init__(self, config: Dict[str, Any]):
        """Initialize engine with configuration.

        Args:
            config: Engine configuration dictionary
        """
        super().__init__(config)
        self._model = None

    def load(self) -> bool:
        """Load SenseVoice model via FunASR.

        Returns:
            True if loaded successfully, False otherwise
        """
        if self._state == EngineState.READY:
            return True

        self._state = EngineState.LOADING
        try:
            from funasr import AutoModel

            model_path = self._config.get("model_path", "iic/SenseVoiceSmall")
            device = self._config.get("device", "cpu")

            self._model = AutoModel(
                model=model_path,
                device=device,
                trust_remote_code=True,
            )

            self._state = EngineState.READY
            self._error = None
            return True
        except Exception as e:
            self._set_error(f"Failed to load SenseVoice: {e}")
            return False

    def unload(self) -> None:
        """Release resources and unload model."""
        if self._model is not None:
            del self._model
            self._model = None
        self._state = EngineState.UNINITIALIZED

    def transcribe(
        self,
        audio: np.ndarray,
        language: str = "auto",
        **kwargs
    ) -> TranscriptionResult:
        """Transcribe audio using SenseVoice.

        Args:
            audio: Audio samples as numpy array (float32, 16kHz, mono)
            language: Language code ("auto", "zh", "en", "ja", "ko", "yue")
            **kwargs: Additional engine-specific parameters

        Returns:
            TranscriptionResult with text and metadata

        Raises:
            RuntimeError: If engine is not in READY state
        """
        if self._state != EngineState.READY:
            raise RuntimeError(f"Engine not ready: {self._state}")

        start = time.monotonic()

        result = self._model.generate(
            input=audio,
            language=language,
            use_itn=self._config.get("use_itn", True),
            batch_size=1,
        )

        text = result[0]["text"] if result else ""
        duration_ms = int((time.monotonic() - start) * 1000)

        return TranscriptionResult(
            text=text,
            duration_ms=duration_ms,
            language=language,
        )

    def transcribe_with_metadata(self, audio: np.ndarray) -> Dict[str, Any]:
        """Transcribe with emotion and event detection.

        Args:
            audio: Audio samples as numpy array (float32, 16kHz, mono)

        Returns:
            Dict with: text, timestamps, emotion, event

        Raises:
            RuntimeError: If engine is not in READY state
        """
        if self._state != EngineState.READY:
            raise RuntimeError(f"Engine not ready: {self._state}")

        from funasr import AutoModel

        # Load with VAD and punctuation models
        model = AutoModel(
            model=self._config.get("model_path", "iic/SenseVoiceSmall"),
            vad_model="fsmn-vad",
            punc_model="ct-punc-c",
            device=self._config.get("device", "cpu"),
            trust_remote_code=True,
        )

        result = model.generate(
            input=audio,
            language="auto",
            use_itn=True,
        )

        return {
            "text": result[0].get("text", ""),
            "timestamps": result[0].get("timestamps", []),
            "emotion": result[0].get("emotion", "unknown"),
            "event": result[0].get("event", "unknown"),
        }