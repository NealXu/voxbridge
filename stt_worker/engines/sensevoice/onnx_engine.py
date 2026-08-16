"""SenseVoice engine via sherpa-onnx (for deployment)."""
import time
import numpy as np
from pathlib import Path
from typing import Dict, Any

from ..base import EngineBase, EngineInfo, EngineState, TranscriptionResult


class SenseVoiceOnnxEngine(EngineBase):
    """SenseVoice using sherpa-onnx for deployment.

    Better for:
    - Standalone binary compilation
    - Smaller footprint
    - Cross-platform distribution
    """

    @classmethod
    def get_info(cls) -> EngineInfo:
        """Return engine metadata."""
        return EngineInfo(
            name="sensevoice-onnx",
            version="1.0.0",
            description="Alibaba SenseVoice via sherpa-onnx",
            supported_languages=["zh", "en", "ja", "ko", "yue"],
            supports_streaming=False,
            requires_gpu=False,
            supports_confidence=False,
        )

    @classmethod
    def get_default_config(cls) -> Dict[str, Any]:
        """Return default configuration."""
        return {
            "model_dir": r"D:\Models\sensevoice-onnx",
            "num_threads": 4,
        }

    def __init__(self, config: Dict[str, Any]):
        """Initialize engine with configuration.

        Args:
            config: Engine configuration dictionary
        """
        super().__init__(config)
        self._recognizer = None

    def load(self) -> bool:
        """Load ONNX model via sherpa-onnx.

        Returns:
            True if loaded successfully, False otherwise
        """
        if self._state == EngineState.READY:
            return True

        self._state = EngineState.LOADING
        try:
            import sherpa_onnx

            model_dir = Path(self._config["model_dir"])

            # Find model files
            model_files = list(model_dir.glob("*.onnx"))
            if not model_files:
                raise FileNotFoundError(f"No ONNX model found in {model_dir}")

            model_file = model_files[0]
            tokens_file = model_dir / "tokens.txt"

            if not tokens_file.exists():
                raise FileNotFoundError(f"tokens.txt not found in {model_dir}")

            self._recognizer = sherpa_onnx.OfflineRecognizer(
                model=str(model_file),
                tokens=str(tokens_file),
                num_threads=self._config.get("num_threads", 4),
                sample_rate=16000,
                decoding_method="greedy_search",
            )

            self._state = EngineState.READY
            self._error = None
            return True
        except Exception as e:
            self._set_error(f"Failed to load SenseVoice ONNX: {e}")
            return False

    def unload(self) -> None:
        """Release resources and unload model."""
        self._recognizer = None
        self._state = EngineState.UNINITIALIZED

    def transcribe(
        self,
        audio: np.ndarray,
        language: str = "auto",
        **kwargs
    ) -> TranscriptionResult:
        """Transcribe audio using sherpa-onnx.

        Args:
            audio: Audio samples as numpy array (float32, 16kHz, mono)
            language: Language code (ignored for ONNX, model handles all)
            **kwargs: Additional engine-specific parameters

        Returns:
            TranscriptionResult with text and metadata

        Raises:
            RuntimeError: If engine is not in READY state
        """
        if self._state != EngineState.READY:
            raise RuntimeError(f"Engine not ready: {self._state}")

        start = time.monotonic()

        stream = self._recognizer.create_stream()
        stream.accept_waveform(16000, audio)
        self._recognizer.decode_stream(stream)

        result = stream.result
        text = result.text
        duration_ms = int((time.monotonic() - start) * 1000)

        return TranscriptionResult(
            text=text,
            duration_ms=duration_ms,
            language=language,
        )