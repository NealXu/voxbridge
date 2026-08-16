"""SenseVoice engine implementation (placeholder for Phase 1)."""
import time
from typing import Dict, Any

import numpy as np

from ..base import EngineBase, EngineInfo, TranscriptionResult, EngineState


class SenseVoiceEngine(EngineBase):
    """SenseVoice ASR engine (placeholder implementation).

    Full implementation will be added in Phase 1.
    This placeholder raises NotImplementedError on load.
    """

    @classmethod
    def get_info(cls) -> EngineInfo:
        """Return engine metadata."""
        return EngineInfo(
            name="sensevoice",
            version="0.1.0",
            description="SenseVoice ASR engine (placeholder - not yet implemented)",
            supported_languages=["zh", "en", "ja", "ko"],
            supports_streaming=False,
            requires_gpu=False,
            supports_confidence=True,
        )

    @classmethod
    def get_default_config(cls) -> Dict[str, Any]:
        """Return default configuration."""
        return {
            "model_dir": "iic/SenseVoiceSmall",
            "device": "cpu",
            "language": "zh",
            "use_itn": True,
        }

    def load(self) -> bool:
        """Load the SenseVoice model (placeholder)."""
        self._state = EngineState.LOADING
        self._set_error("SenseVoice engine not yet implemented - coming in Phase 1")
        return False

    def unload(self) -> None:
        """Unload the model."""
        self._state = EngineState.UNINITIALIZED

    def transcribe(
        self,
        audio: np.ndarray,
        language: str = "zh",
        **kwargs
    ) -> TranscriptionResult:
        """Transcribe audio (placeholder)."""
        raise NotImplementedError("SenseVoice engine not yet implemented")