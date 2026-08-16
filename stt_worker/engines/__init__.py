"""STT engine implementations and factory.

This package provides a plugin architecture for multiple STT engines:
- whisper: Whisper ASR using faster-whisper (current default)
- sensevoice: SenseVoice ASR (Phase 1)
- paraformer: Paraformer ASR (Phase 3)
- dummy: Dummy engine for testing
"""

from .base import (
    EngineBase,
    EngineInfo,
    EngineState,
    TranscriptionResult,
)
from .factory import EngineFactory, EngineRegistry
from .config import (
    EngineConfig,
    WhisperConfig,
    SenseVoiceConfig,
    ParaformerConfig,
    DummyConfig,
    get_config_schema,
)

__all__ = [
    # Base classes
    "EngineBase",
    "EngineInfo",
    "EngineState",
    "TranscriptionResult",
    # Factory
    "EngineFactory",
    "EngineRegistry",
    # Config
    "EngineConfig",
    "WhisperConfig",
    "SenseVoiceConfig",
    "ParaformerConfig",
    "DummyConfig",
    "get_config_schema",
]