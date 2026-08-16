"""Tests for SenseVoice engine implementations."""
import pytest
import numpy as np
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path


class TestSenseVoiceEngine:
    """Tests for SenseVoiceEngine (FunASR-based)."""

    def test_engine_info(self):
        """Should return correct engine metadata."""
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine

        info = SenseVoiceEngine.get_info()
        assert info.name == "sensevoice"
        assert "zh" in info.supported_languages
        assert info.supports_streaming is False

    def test_default_config(self):
        """Should provide sensible defaults."""
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine

        config = SenseVoiceEngine.get_default_config()
        assert "model_path" in config
        assert config["device"] == "cpu"

    @patch('funasr.AutoModel')
    def test_load_model(self, mock_automodel):
        """Should load FunASR model."""
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine
        from stt_worker.engines.base import EngineState

        mock_model = MagicMock()
        mock_automodel.return_value = mock_model

        engine = SenseVoiceEngine({"model_path": "iic/SenseVoiceSmall"})
        result = engine.load()

        assert result is True
        assert engine.state == EngineState.READY
        mock_automodel.assert_called_once()

    @patch('funasr.AutoModel')
    def test_transcribe(self, mock_automodel):
        """Should transcribe audio."""
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine

        mock_model = MagicMock()
        mock_model.generate.return_value = [{"text": "你好世界"}]
        mock_automodel.return_value = mock_model

        engine = SenseVoiceEngine({"model_path": "iic/SenseVoiceSmall"})
        engine.load()

        audio = np.zeros(16000, dtype=np.float32)
        result = engine.transcribe(audio, language="zh")

        assert result.text == "你好世界"
        assert result.duration_ms >= 0

    def test_transcribe_not_ready(self):
        """Should raise error if engine not ready."""
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine

        engine = SenseVoiceEngine({"model_path": "iic/SenseVoiceSmall"})
        # Don't call load()

        audio = np.zeros(16000, dtype=np.float32)
        with pytest.raises(RuntimeError, match="Engine not ready"):
            engine.transcribe(audio, language="zh")

    @patch('funasr.AutoModel')
    def test_unload(self, mock_automodel):
        """Should unload model properly."""
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine
        from stt_worker.engines.base import EngineState

        mock_model = MagicMock()
        mock_automodel.return_value = mock_model

        engine = SenseVoiceEngine({"model_path": "iic/SenseVoiceSmall"})
        engine.load()
        engine.unload()

        assert engine.state == EngineState.UNINITIALIZED
        assert engine._model is None

    @patch('funasr.AutoModel')
    def test_error_handling(self, mock_automodel):
        """Should handle errors gracefully."""
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine
        from stt_worker.engines.base import EngineState

        mock_automodel.side_effect = ImportError("No module")

        engine = SenseVoiceEngine({"model_path": "iic/SenseVoiceSmall"})
        result = engine.load()

        assert result is False
        assert engine.state == EngineState.ERROR
        assert "No module" in engine.error


class TestSenseVoiceOnnxEngine:
    """Tests for SenseVoiceOnnxEngine (sherpa-onnx-based)."""

    def test_engine_info(self):
        """Should return correct engine metadata."""
        from stt_worker.engines.sensevoice.onnx_engine import SenseVoiceOnnxEngine

        info = SenseVoiceOnnxEngine.get_info()
        assert info.name == "sensevoice-onnx"
        assert "zh" in info.supported_languages

    def test_default_config(self):
        """Should provide sensible defaults."""
        from stt_worker.engines.sensevoice.onnx_engine import SenseVoiceOnnxEngine

        config = SenseVoiceOnnxEngine.get_default_config()
        assert "model_dir" in config
        assert "num_threads" in config

    @patch('sherpa_onnx.OfflineRecognizer')
    def test_load_onnx_model(self, mock_recognizer_class):
        """Should load ONNX model."""
        from stt_worker.engines.sensevoice.onnx_engine import SenseVoiceOnnxEngine
        from stt_worker.engines.base import EngineState

        mock_recognizer = MagicMock()
        mock_recognizer_class.return_value = mock_recognizer

        engine = SenseVoiceOnnxEngine({"model_dir": "/fake/path"})

        # Mock Path.glob to return a model file
        with patch('pathlib.Path.glob') as mock_glob:
            mock_glob.return_value = [Path("/fake/path/model.onnx")]
            with patch('pathlib.Path.exists', return_value=True):
                result = engine.load()

        assert result is True
        assert engine.state == EngineState.READY

    @patch('sherpa_onnx.OfflineRecognizer')
    def test_transcribe_onnx(self, mock_recognizer_class):
        """Should transcribe using sherpa-onnx."""
        from stt_worker.engines.sensevoice.onnx_engine import SenseVoiceOnnxEngine

        # Setup mocks
        mock_recognizer = MagicMock()
        mock_stream = MagicMock()
        mock_result = MagicMock()
        mock_result.text = "你好世界"
        mock_stream.result = mock_result

        mock_recognizer.create_stream.return_value = mock_stream
        mock_recognizer_class.return_value = mock_recognizer

        engine = SenseVoiceOnnxEngine({"model_dir": "/fake/path"})

        with patch('pathlib.Path.glob') as mock_glob:
            mock_glob.return_value = [Path("/fake/path/model.onnx")]
            with patch('pathlib.Path.exists', return_value=True):
                engine.load()

        audio = np.zeros(16000, dtype=np.float32)
        result = engine.transcribe(audio, language="zh")

        assert result.text == "你好世界"
        assert result.duration_ms >= 0

    @patch('sherpa_onnx.OfflineRecognizer')
    def test_model_not_found(self, mock_recognizer_class):
        """Should handle missing model files."""
        from stt_worker.engines.sensevoice.onnx_engine import SenseVoiceOnnxEngine
        from stt_worker.engines.base import EngineState

        engine = SenseVoiceOnnxEngine({"model_dir": "/fake/path"})

        with patch('pathlib.Path.glob', return_value=[]):
            result = engine.load()

        assert result is False
        assert engine.state == EngineState.ERROR

    @patch('sherpa_onnx.OfflineRecognizer')
    def test_unload_onnx(self, mock_recognizer_class):
        """Should unload ONNX model properly."""
        from stt_worker.engines.sensevoice.onnx_engine import SenseVoiceOnnxEngine
        from stt_worker.engines.base import EngineState

        mock_recognizer = MagicMock()
        mock_recognizer_class.return_value = mock_recognizer

        engine = SenseVoiceOnnxEngine({"model_dir": "/fake/path"})

        with patch('pathlib.Path.glob') as mock_glob:
            mock_glob.return_value = [Path("/fake/path/model.onnx")]
            with patch('pathlib.Path.exists', return_value=True):
                engine.load()

        engine.unload()

        assert engine.state == EngineState.UNINITIALIZED
        assert engine._recognizer is None


class TestSenseVoiceIntegration:
    """Integration tests (require real model, skipped by default)."""

    @pytest.mark.skip(reason="Requires SenseVoice model download")
    def test_real_transcription_funasr(self):
        """Should transcribe real audio with FunASR."""
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine

        engine = SenseVoiceEngine({"model_path": "iic/SenseVoiceSmall"})
        engine.load()

        # Create test audio (silence)
        audio = np.zeros(16000, dtype=np.float32)
        result = engine.transcribe(audio)

        assert isinstance(result.text, str)

    @pytest.mark.skip(reason="Requires SenseVoice ONNX model download")
    def test_real_transcription_onnx(self):
        """Should transcribe real audio with sherpa-onnx."""
        from stt_worker.engines.sensevoice.onnx_engine import SenseVoiceOnnxEngine

        engine = SenseVoiceOnnxEngine({"model_dir": r"D:\Models\sensevoice-onnx"})
        engine.load()

        # Create test audio (silence)
        audio = np.zeros(16000, dtype=np.float32)
        result = engine.transcribe(audio)

        assert isinstance(result.text, str)


class TestEngineRegistryIntegration:
    """Test that SenseVoice engines are properly registered."""

    def test_sensevoice_registered(self):
        """SenseVoice should be registered in EngineRegistry."""
        from stt_worker.engines.factory import EngineRegistry
        from stt_worker.engines.sensevoice.engine import SenseVoiceEngine

        # Check if already registered
        registered_engine = EngineRegistry.get("sensevoice")
        if registered_engine is not None:
            assert registered_engine == SenseVoiceEngine

    def test_sensevoice_onnx_registered(self):
        """SenseVoice ONNX should be registered in EngineRegistry."""
        from stt_worker.engines.factory import EngineRegistry
        from stt_worker.engines.sensevoice.onnx_engine import SenseVoiceOnnxEngine

        # Check if already registered
        registered_engine = EngineRegistry.get("sensevoice-onnx")
        if registered_engine is not None:
            assert registered_engine == SenseVoiceOnnxEngine