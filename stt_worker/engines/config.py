"""Configuration schemas for STT engines using Pydantic."""
from typing import Dict, Any, Optional, Literal
from pydantic import BaseModel, Field, ConfigDict


class WhisperConfig(BaseModel):
    """Configuration for Whisper engine."""
    model_config = ConfigDict(extra="allow")

    model_dir: str = Field(default=r"D:\Models\faster-whisper-large-v3")
    model: str = Field(default="large-v3")
    device: Literal["cpu", "cuda", "auto"] = Field(default="cpu")
    compute_type: str = Field(default="int8")
    language: str = Field(default="zh")


class SenseVoiceConfig(BaseModel):
    """Configuration for SenseVoice engine (placeholder for Phase 1)."""
    model_config = ConfigDict(extra="allow")

    model_dir: str = Field(default="iic/SenseVoiceSmall")
    device: Literal["cpu", "cuda", "auto"] = Field(default="cpu")
    language: str = Field(default="zh")
    use_itn: bool = Field(default=True)


class ParaformerConfig(BaseModel):
    """Configuration for Paraformer engine (placeholder for Phase 3)."""
    model_config = ConfigDict(extra="allow")

    model_dir: str = Field(default="iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch")
    device: Literal["cpu", "cuda", "auto"] = Field(default="cpu")
    language: str = Field(default="zh")


class DummyConfig(BaseModel):
    """Configuration for Dummy engine (testing)."""
    model_config = ConfigDict(extra="allow")

    latency_ms: int = Field(default=10, description="Simulated latency in milliseconds")


class EngineConfig(BaseModel):
    """Base engine configuration."""
    model_config = ConfigDict(extra="allow")

    engine: str = Field(default="whisper")
    fallback: Optional[str] = Field(default=None, description="Fallback engine if primary fails")

    # Engine-specific configs
    whisper: WhisperConfig = Field(default_factory=WhisperConfig)
    sensevoice: SenseVoiceConfig = Field(default_factory=SenseVoiceConfig)
    paraformer: ParaformerConfig = Field(default_factory=ParaformerConfig)
    dummy: DummyConfig = Field(default_factory=DummyConfig)


def get_config_schema(engine_name: str) -> type:
    """Get the configuration schema for an engine.

    Args:
        engine_name: Name of the engine (whisper, sensevoice, etc.)

    Returns:
        Pydantic model class for the engine's configuration
    """
    schemas = {
        "whisper": WhisperConfig,
        "sensevoice": SenseVoiceConfig,
        "paraformer": ParaformerConfig,
        "dummy": DummyConfig,
    }
    return schemas.get(engine_name, BaseModel)