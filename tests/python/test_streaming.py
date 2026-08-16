"""Tests for streaming ASR functionality."""
import pytest
import numpy as np
from unittest.mock import Mock, patch, MagicMock
from typing import List


class TestParaformerStreamingEngine:
    """Tests for Paraformer streaming engine."""

    def test_engine_info(self):
        """Should support streaming."""
        from stt_worker.engines.paraformer.engine import ParaformerStreamingEngine

        info = ParaformerStreamingEngine.get_info()
        assert info.name == "paraformer"
        assert info.supports_streaming is True
        assert "zh" in info.supported_languages

    def test_load_streaming_model(self):
        """Should load streaming recognizer."""
        from stt_worker.engines.paraformer.engine import ParaformerStreamingEngine
        from stt_worker.engines.base import EngineState

        mock_recognizer = MagicMock()
        mock_sherpa = MagicMock()
        mock_sherpa.OnlineRecognizer.return_value = mock_recognizer

        with patch.dict('sys.modules', {'sherpa_onnx': mock_sherpa}):
            with patch('pathlib.Path.exists', return_value=True):
                engine = ParaformerStreamingEngine({"model_dir": "/fake/path"})
                result = engine.load()

        assert result is True
        assert engine.state == EngineState.READY

    def test_start_utterance(self):
        """Should create stream for new utterance."""
        from stt_worker.engines.paraformer.engine import ParaformerStreamingEngine

        mock_recognizer = MagicMock()
        mock_stream = MagicMock()
        mock_recognizer.create_stream.return_value = mock_stream
        mock_sherpa = MagicMock()
        mock_sherpa.OnlineRecognizer.return_value = mock_recognizer

        with patch.dict('sys.modules', {'sherpa_onnx': mock_sherpa}):
            with patch('pathlib.Path.exists', return_value=True):
                engine = ParaformerStreamingEngine({"model_dir": "/fake/path"})
                engine.load()
                engine.start_utterance()

        mock_recognizer.create_stream.assert_called_once()

    def test_accept_chunk(self):
        """Should process audio chunk and return partial result."""
        from stt_worker.engines.paraformer.engine import ParaformerStreamingEngine

        mock_recognizer = MagicMock()
        mock_stream = MagicMock()
        mock_result = MagicMock()
        mock_result.text = "你好"

        mock_recognizer.create_stream.return_value = mock_stream
        # Return True once, then False to break the while loop
        mock_recognizer.is_ready.side_effect = [True, False]
        mock_recognizer.get_result.return_value = mock_result
        mock_sherpa = MagicMock()
        mock_sherpa.OnlineRecognizer.return_value = mock_recognizer

        with patch.dict('sys.modules', {'sherpa_onnx': mock_sherpa}):
            with patch('pathlib.Path.exists', return_value=True):
                engine = ParaformerStreamingEngine({"model_dir": "/fake/path"})
                engine.load()
                engine.start_utterance()

                chunk = np.zeros(8000, dtype=np.float32)  # 500ms
                result = engine.accept_chunk(chunk)

        mock_stream.accept_waveform.assert_called_once()
        assert result == "你好"

    def test_end_utterance(self):
        """Should finalize and return final result."""
        from stt_worker.engines.paraformer.engine import ParaformerStreamingEngine

        mock_recognizer = MagicMock()
        mock_stream = MagicMock()
        mock_result = MagicMock()
        mock_result.text = "你好世界"

        mock_recognizer.create_stream.return_value = mock_stream
        # Return True once, then False to break the while loop
        mock_recognizer.is_ready.side_effect = [True, False]
        mock_recognizer.get_result.return_value = mock_result
        mock_sherpa = MagicMock()
        mock_sherpa.OnlineRecognizer.return_value = mock_recognizer

        with patch.dict('sys.modules', {'sherpa_onnx': mock_sherpa}):
            with patch('pathlib.Path.exists', return_value=True):
                engine = ParaformerStreamingEngine({"model_dir": "/fake/path"})
                engine.load()
                engine.start_utterance()
                result = engine.end_utterance()

        mock_stream.input_finished.assert_called_once()
        assert result == "你好世界"

    def test_transcribe_non_streaming(self):
        """Should support non-streaming transcription for compatibility."""
        from stt_worker.engines.paraformer.engine import ParaformerStreamingEngine

        mock_recognizer = MagicMock()
        mock_stream = MagicMock()
        mock_result = MagicMock()
        mock_result.text = "测试文本"

        mock_recognizer.create_stream.return_value = mock_stream
        # Return True once for accept_chunk, then True once for end_utterance, then False
        mock_recognizer.is_ready.side_effect = [True, False, True, False]
        mock_recognizer.get_result.return_value = mock_result
        mock_sherpa = MagicMock()
        mock_sherpa.OnlineRecognizer.return_value = mock_recognizer

        with patch.dict('sys.modules', {'sherpa_onnx': mock_sherpa}):
            with patch('pathlib.Path.exists', return_value=True):
                engine = ParaformerStreamingEngine({"model_dir": "/fake/path"})
                engine.load()
                audio = np.zeros(16000, dtype=np.float32)
                result = engine.transcribe(audio)

        assert result.text == "测试文本"
        assert result.duration_ms >= 0


class TestStreamingASR:
    """Tests for StreamingASR manager."""

    def test_vad_gated_streaming(self):
        """Should only process during speech."""
        from stt_worker.streaming_asr import StreamingASR, StreamingConfig
        from unittest.mock import MagicMock

        mock_engine = MagicMock()
        mock_engine.start_utterance = MagicMock()
        mock_engine.accept_chunk = MagicMock(return_value="测试")

        config = StreamingConfig(chunk_ms=500, vad_threshold=0.5)

        on_partial = MagicMock()
        on_final = MagicMock()

        asr = StreamingASR(mock_engine, config, on_partial, on_final)

        # Speech detected
        chunk = np.zeros(8000, dtype=np.float32)
        asr.process_chunk(chunk, vad_score=0.8)

        mock_engine.start_utterance.assert_called_once()
        on_partial.assert_called()

    def test_endpoint_detection(self):
        """Should finalize after silence."""
        from stt_worker.streaming_asr import StreamingASR, StreamingConfig
        from unittest.mock import MagicMock

        mock_engine = MagicMock()
        mock_engine.end_utterance.return_value = "测试文本"

        config = StreamingConfig(chunk_ms=500, endpoint_silence_ms=400)

        on_partial = MagicMock()
        on_final = MagicMock()

        asr = StreamingASR(mock_engine, config, on_partial, on_final)

        # Start speech
        chunk = np.zeros(8000, dtype=np.float32)
        asr.process_chunk(chunk, vad_score=0.8)

        # Silence for > endpoint_silence_ms
        asr.process_chunk(chunk, vad_score=0.1)  # 500ms silence

        on_final.assert_called_once()

    def test_cancel_utterance(self):
        """Should discard partial results on cancel."""
        from stt_worker.streaming_asr import StreamingASR, StreamingConfig
        from unittest.mock import MagicMock

        mock_engine = MagicMock()

        config = StreamingConfig()
        asr = StreamingASR(mock_engine, config, MagicMock(), MagicMock())

        # Start speech
        chunk = np.zeros(8000, dtype=np.float32)
        asr.process_chunk(chunk, vad_score=0.8)

        # Cancel
        asr.cancel()

        mock_engine.end_utterance.assert_called_once()
        assert asr._is_speaking is False

    def test_continuous_speech(self):
        """Should handle continuous speech across multiple chunks."""
        from stt_worker.streaming_asr import StreamingASR, StreamingConfig
        from unittest.mock import MagicMock

        mock_engine = MagicMock()
        mock_engine.accept_chunk.side_effect = ["你", "你好", "你好世", "你好世界"]

        config = StreamingConfig(chunk_ms=500, endpoint_silence_ms=400)

        partials = []
        on_partial = MagicMock(side_effect=lambda t: partials.append(t))
        on_final = MagicMock()

        asr = StreamingASR(mock_engine, config, on_partial, on_final)

        # Multiple speech chunks
        chunk = np.zeros(8000, dtype=np.float32)
        for _ in range(4):
            asr.process_chunk(chunk, vad_score=0.8)

        # Then silence to finalize
        asr.process_chunk(chunk, vad_score=0.1)

        assert len(partials) == 4
        on_final.assert_called_once()

    def test_no_final_on_empty(self):
        """Should not call on_final when result is empty."""
        from stt_worker.streaming_asr import StreamingASR, StreamingConfig
        from unittest.mock import MagicMock

        mock_engine = MagicMock()
        mock_engine.end_utterance.return_value = ""

        config = StreamingConfig(chunk_ms=500, endpoint_silence_ms=400)

        on_partial = MagicMock()
        on_final = MagicMock()

        asr = StreamingASR(mock_engine, config, on_partial, on_final)

        # Speech detected then silence
        chunk = np.zeros(8000, dtype=np.float32)
        asr.process_chunk(chunk, vad_score=0.8)
        asr.process_chunk(chunk, vad_score=0.1)

        # Should not call on_final for empty result
        on_final.assert_not_called()


class TestStreamingConfig:
    """Tests for StreamingConfig dataclass."""

    def test_default_values(self):
        """Should have sensible defaults."""
        from stt_worker.streaming_asr import StreamingConfig

        config = StreamingConfig()

        assert config.chunk_ms == 500
        assert config.endpoint_silence_ms == 400
        assert config.vad_threshold == 0.5

    def test_custom_values(self):
        """Should accept custom configuration."""
        from stt_worker.streaming_asr import StreamingConfig

        config = StreamingConfig(
            chunk_ms=300,
            endpoint_silence_ms=600,
            vad_threshold=0.7
        )

        assert config.chunk_ms == 300
        assert config.endpoint_silence_ms == 600
        assert config.vad_threshold == 0.7


class TestStreamingIntegration:
    """Integration tests (require real model)."""

    @pytest.mark.skip(reason="Requires Paraformer streaming model")
    def test_real_streaming(self):
        """Should transcribe in real-time."""
        from stt_worker.engines.paraformer.engine import ParaformerStreamingEngine
        from stt_worker.streaming_asr import StreamingASR, StreamingConfig

        engine = ParaformerStreamingEngine({"model_dir": r"D:\Models\paraformer-streaming"})
        engine.load()

        partials: List[str] = []
        finals: List[str] = []

        config = StreamingConfig(chunk_ms=500)
        asr = StreamingASR(
            engine, config,
            on_partial=lambda t: partials.append(t),
            on_final=lambda t, d: finals.append(t)
        )

        # Simulate audio chunks
        for _ in range(10):
            chunk = np.random.randn(8000).astype(np.float32) * 0.1
            asr.process_chunk(chunk, vad_score=0.8)

        asr.stop()

        assert len(finals) > 0