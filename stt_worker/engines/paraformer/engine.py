"""Paraformer engine implementation (placeholder for Phase 3)."""
import time
from typing import Dict, Any

import numpy as np

from ..base import EngineBase, EngineInfo, TranscriptionResult, EngineState


class ParaformerEngine(EngineBase):
    """Paraformer ASR engine (placeholder implementation).

    Full implementation will be added in Phase 3.
    This placeholder raises NotImplementedError on load.
    """

    @classmethod
    def get_info(cls) -> EngineInfo:
        """Return engine metadata."""
        return EngineInfo(
            name="paraformer",
            version="0.1.0",
            description="Paraformer ASR engine (placeholder - not yet implemented)",
            supported_languages=["zh"],
            supports_streaming=False,
            requires_gpu=False,
            supports_confidence=True,
        )

    @classmethod
    def get_default_config(cls) -> Dict[str, Any]:
        """Return default configuration."""
        return {
            "model_dir": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
            "device": "cpu",
            "language": "zh",
        }

    def load(self) -> bool:
        """Load the Paraformer model (placeholder)."""
        self._state = EngineState.LOADING
        self._set_error("Paraformer engine not yet implemented - coming in Phase 3")
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
        raise NotImplementedError("Paraformer engine not yet implemented")