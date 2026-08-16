"""Tests for multi-engine STT architecture."""
import pytest
import numpy as np
from unittest.mock import Mock, patch
from pathlib import Path


class TestEngineBase:
    """Tests for EngineBase abstract class."""

    def test_engine_info_dataclass(self):
        """EngineInfo should store metadata."""
        from stt_worker.engines.base import EngineInfo

        info = EngineInfo(
            name="test",
            version="1.0.0",
            description="Test engine",
            supported_languages=["zh", "en"],
            supports_streaming=False,
            requires_gpu=False,
        )

        assert info.name == "test"
        assert info.version == "1.0.0"
        assert "zh" in info.supported_languages

    def test_transcription_result_dataclass(self):
        """TranscriptionResult should store transcription output."""
        from stt_worker.engines.base import TranscriptionResult

        result = TranscriptionResult(
            text="你好世界",
            duration_ms=500,
            language="zh",
            confidence=0.95,
        )

        assert result.text == "你好世界"
        assert result.duration_ms == 500
        assert result.confidence == 0.95


class TestEngineRegistry:
    """Tests for EngineRegistry."""

    def test_register_engine(self):
        """Should register engine class."""
        from stt_worker.engines.factory import EngineRegistry
        from stt_worker.engines.base import EngineBase, EngineInfo

        class MockEngine(EngineBase):
            @classmethod
            def get_info(cls):
                return EngineInfo("mock", "1.0", "Mock", ["zh"])

            @classmethod
            def get_default_config(cls):
                return {}

            def load(self): return True
            def unload(self): pass
            def transcribe(self, audio, language="zh"):
                from stt_worker.engines.base import TranscriptionResult
                return TranscriptionResult("test", 100)

        EngineRegistry.register(MockEngine)
        assert EngineRegistry.get("mock") == MockEngine

    def test_list_engines(self):
        """Should list all registered engines."""
        from stt_worker.engines.factory import EngineRegistry

        engines = EngineRegistry.list_engines()
        assert isinstance(engines, list)


class TestEngineFactory:
    """Tests for EngineFactory."""

    def test_create_engine(self):
        """Should create engine instance."""
        from stt_worker.engines.factory import EngineFactory, EngineRegistry
        from stt_worker.engines.dummy.engine import DummyEngine

        # Register dummy engine
        EngineRegistry.register(DummyEngine)

        factory = EngineFactory({})
        engine = factory.create_engine("dummy")

        assert engine is not None
        assert isinstance(engine, DummyEngine)

    def test_initialize_with_fallback(self):
        """Should initialize with fallback support."""
        from stt_worker.engines.factory import EngineFactory

        factory = EngineFactory({})
        success, message = factory.initialize("dummy", fallback="dummy")

        assert success is True

    def test_switch_engine(self):
        """Should hot-swap engines."""
        from stt_worker.engines.factory import EngineFactory, EngineRegistry
        from stt_worker.engines.dummy.engine import DummyEngine

        EngineRegistry.register(DummyEngine)

        factory = EngineFactory({})
        factory.initialize("dummy")

        success, message = factory.switch_engine("dummy")
        assert success is True


class TestDummyEngine:
    """Tests for DummyEngine (for testing)."""

    def test_load_and_transcribe(self):
        """DummyEngine should work for testing."""
        from stt_worker.engines.dummy.engine import DummyEngine
        from stt_worker.engines.base import EngineState

        engine = DummyEngine({})
        assert engine.load() is True
        assert engine.state == EngineState.READY

        audio = np.zeros(16000, dtype=np.float32)
        result = engine.transcribe(audio)

        assert result.text == "dummy transcription"
        assert result.duration_ms > 0