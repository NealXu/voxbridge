"""Paraformer streaming engine via sherpa-onnx."""
import time
import numpy as np
from pathlib import Path
from typing import Optional, Dict, Any
from ..base import EngineBase, EngineInfo, EngineState, TranscriptionResult


class ParaformerStreamingEngine(EngineBase):
    """Paraformer streaming engine for real-time ASR.

    Features:
    - Real-time partial results
    - Low latency (100-300ms)
    - Chinese optimized
    - VAD-gated processing
    """

    @classmethod
    def get_info(cls) -> EngineInfo:
        return EngineInfo(
            name="paraformer",
            version="1.0.0",
            description="Alibaba Paraformer streaming via sherpa-onnx",
            supported_languages=["zh"],
            supports_streaming=True,
            requires_gpu=False,
        )

    @classmethod
    def get_default_config(cls) -> Dict[str, Any]:
        return {
            "model_dir": r"D:\Models\paraformer-streaming",
            "num_threads": 4,
            "sample_rate": 16000,
            "feature_dim": 80,
        }

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._recognizer = None
        self._stream = None

    def load(self) -> bool:
        """Load Paraformer streaming model."""
        if self._state == EngineState.READY:
            return True

        self._state = EngineState.LOADING
        try:
            import sherpa_onnx

            model_dir = Path(self._config["model_dir"])

            # Check for required files
            tokens = model_dir / "tokens.txt"
            encoder = model_dir / "encoder.onnx"
            decoder = model_dir / "decoder.onnx"
            joiner = model_dir / "joiner.onnx"

            if not all(f.exists() for f in [tokens, encoder, decoder, joiner]):
                raise FileNotFoundError(f"Missing model files in {model_dir}")

            self._recognizer = sherpa_onnx.OnlineRecognizer(
                tokens=str(tokens),
                encoder=str(encoder),
                decoder=str(decoder),
                joiner=str(joiner),
                num_threads=self._config.get("num_threads", 4),
                sample_rate=self._config.get("sample_rate", 16000),
                feature_dim=self._config.get("feature_dim", 80),
                decoding_method="greedy_search",
            )

            self._state = EngineState.READY
            self._error = None
            return True
        except Exception as e:
            self._set_error(f"Failed to load Paraformer: {e}")
            return False

    def start_utterance(self) -> None:
        """Start a new utterance stream."""
        if self._recognizer is None:
            raise RuntimeError("Engine not loaded")
        self._stream = self._recognizer.create_stream()

    def accept_chunk(self, chunk: np.ndarray) -> Optional[str]:
        """Process audio chunk, return partial result if available."""
        if self._stream is None:
            raise RuntimeError("Call start_utterance() first")

        self._stream.accept_waveform(
            self._config.get("sample_rate", 16000),
            chunk
        )

        while self._recognizer.is_ready(self._stream):
            self._recognizer.decode_stream(self._stream)

        result = self._recognizer.get_result(self._stream)
        return result.text if result else None

    def end_utterance(self) -> str:
        """End utterance and get final result."""
        if self._stream is None:
            return ""

        self._stream.input_finished()

        while self._recognizer.is_ready(self._stream):
            self._recognizer.decode_stream(self._stream)

        result = self._recognizer.get_result(self._stream)
        text = result.text if result else ""

        self._stream = None
        return text

    def unload(self) -> None:
        """Unload the model."""
        self._recognizer = None
        self._stream = None
        self._state = EngineState.UNINITIALIZED

    def transcribe(self, audio: np.ndarray, language: str = "zh", **kwargs) -> TranscriptionResult:
        """Non-streaming transcription (for compatibility)."""
        start = time.monotonic()

        self.start_utterance()
        self.accept_chunk(audio)
        text = self.end_utterance()

        duration_ms = int((time.monotonic() - start) * 1000)
        return TranscriptionResult(text=text, duration_ms=duration_ms)