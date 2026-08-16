"""Dummy engine for testing purposes."""
import time
from typing import Dict, Any

import numpy as np

from ..base import EngineBase, EngineInfo, TranscriptionResult, EngineState


class DummyEngine(EngineBase):
    """Simple dummy engine for testing.

    Returns a fixed transcription string and simulates latency.
    """

    @classmethod
    def get_info(cls) -> EngineInfo:
        """Return engine metadata."""
        return EngineInfo(
            name="dummy",
            version="1.0.0",
            description="Dummy engine for testing",
            supported_languages=["zh", "en"],
            supports_streaming=False,
            requires_gpu=False,
        )

    @classmethod
    def get_default_config(cls) -> Dict[str, Any]:
        """Return default configuration."""
        return {
            "latency_ms": 10,
        }

    def load(self) -> bool:
        """Load the dummy engine (instant)."""
        self._state = EngineState.LOADING

        # Simulate minimal load time
        time.sleep(0.001)

        self._state = EngineState.READY
        return True

    def unload(self) -> None:
        """Unload the dummy engine (instant)."""
        self._state = EngineState.UNINITIALIZED

    def transcribe(
        self,
        audio: np.ndarray,
        language: str = "zh",
        **kwargs
    ) -> TranscriptionResult:
        """Return dummy transcription.

        Args:
            audio: Audio samples (ignored)
            language: Language code (ignored)
            **kwargs: Additional parameters (ignored)

        Returns:
            TranscriptionResult with fixed text
        """
        if not self.is_ready():
            raise RuntimeError("Engine not ready. Call load() first.")

        # Simulate processing latency
        latency_ms = self._config.get("latency_ms", 10)
        start_time = time.monotonic()

        # Ensure minimum processing time for accurate duration measurement
        time.sleep(max(latency_ms / 1000.0, 0.001))

        actual_duration_ms = max(1, int((time.monotonic() - start_time) * 1000))

        return TranscriptionResult(
            text="dummy transcription",
            duration_ms=actual_duration_ms,
            language=language,
            confidence=1.0,
        )