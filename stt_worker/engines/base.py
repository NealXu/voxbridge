"""Base classes and data structures for STT engines."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Any, List, Optional

import numpy as np


class EngineState(Enum):
    """Engine lifecycle states."""
    UNINITIALIZED = "uninitialized"
    LOADING = "loading"
    READY = "ready"
    ERROR = "error"


@dataclass
class EngineInfo:
    """Metadata about an STT engine."""
    name: str
    version: str
    description: str
    supported_languages: List[str]
    supports_streaming: bool = False
    requires_gpu: bool = False
    supports_confidence: bool = False
    supports_word_timestamps: bool = False


@dataclass
class TranscriptionResult:
    """Result of a transcription operation."""
    text: str
    duration_ms: int
    language: Optional[str] = None
    confidence: Optional[float] = None
    segments: Optional[List[Dict[str, Any]]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class EngineBase(ABC):
    """Abstract base class for STT engines.

    All engine implementations must inherit from this class and implement
    the required abstract methods.
    """

    def __init__(self, config: Dict[str, Any]):
        """Initialize engine with configuration.

        Args:
            config: Engine-specific configuration dictionary
        """
        self._state = EngineState.UNINITIALIZED
        self._config = config
        self._error: Optional[str] = None

    @property
    def state(self) -> EngineState:
        """Current engine state."""
        return self._state

    @property
    def error(self) -> Optional[str]:
        """Last error message, if any."""
        return self._error

    @classmethod
    @abstractmethod
    def get_info(cls) -> EngineInfo:
        """Return engine metadata.

        Returns:
            EngineInfo containing engine metadata
        """
        pass

    @classmethod
    @abstractmethod
    def get_default_config(cls) -> Dict[str, Any]:
        """Return default configuration for this engine.

        Returns:
            Dictionary with default configuration values
        """
        pass

    @abstractmethod
    def load(self) -> bool:
        """Load the model and prepare engine for transcription.

        This method should:
        - Load model weights
        - Initialize any required resources
        - Set state to READY on success or ERROR on failure

        Returns:
            True if loaded successfully, False otherwise
        """
        pass

    @abstractmethod
    def unload(self) -> None:
        """Release resources and unload model.

        This method should:
        - Free GPU/CPU memory
        - Release any held resources
        - Set state to UNINITIALIZED
        """
        pass

    @abstractmethod
    def transcribe(
        self,
        audio: np.ndarray,
        language: str = "zh",
        **kwargs
    ) -> TranscriptionResult:
        """Transcribe audio data.

        Args:
            audio: Audio samples as numpy array (float32, 16kHz)
            language: Language code (e.g., "zh", "en")
            **kwargs: Additional engine-specific parameters

        Returns:
            TranscriptionResult with transcription output

        Raises:
            RuntimeError: If engine is not in READY state
        """
        pass

    def is_ready(self) -> bool:
        """Check if engine is ready for transcription.

        Returns:
            True if engine is in READY state
        """
        return self._state == EngineState.READY

    def _set_error(self, message: str) -> None:
        """Set error state and message.

        Args:
            message: Error description
        """
        self._error = message
        self._state = EngineState.ERROR