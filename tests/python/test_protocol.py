import pytest
from stt_worker.protocol import encode, decode


def test_encode_result():
    assert encode({"type": "result", "text": "改一下", "duration_ms": 1200}) == \
        '{"type": "result", "text": "改一下", "duration_ms": 1200}\n'


def test_decode_roundtrip():
    assert decode('{"type": "start"}\n') == {"type": "start"}


def test_decode_invalid_raises():
    with pytest.raises(ValueError):
        decode("not-json\n")
