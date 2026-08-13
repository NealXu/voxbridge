import numpy as np
import pytest
from stt_worker.whisper_engine import WhisperEngine

MODEL_DIR = r"D:\Models\faster-whisper-large-v3"


@pytest.mark.integration
def test_silence_returns_empty():
    engine = WhisperEngine(MODEL_DIR)
    engine.load()
    text, _ = engine.transcribe(np.zeros(32000, dtype="float32"))  # 2s 静音
    assert text == ""


@pytest.mark.integration
def test_large_model_loaded():
    import os
    assert os.path.isfile(os.path.join(MODEL_DIR, "model.bin"))
