# Streaming ASR Support

This document describes the streaming ASR (Automatic Speech Recognition) implementation for real-time transcription.

## Overview

Streaming ASR provides real-time partial transcription results with low latency (100-300ms), compared to batch ASR which processes entire audio files (3-6s latency).

## Architecture

### Components

1. **ParaformerStreamingEngine** (`stt_worker/engines/paraformer/engine.py`)
   - Real-time streaming via sherpa-onnx
   - Low latency (100-300ms)
   - Chinese language optimized
   - VAD-gated processing

2. **StreamingASR** (`stt_worker/streaming_asr.py`)
   - Manages streaming flow with VAD integration
   - Endpoint detection for utterance segmentation
   - Callbacks for partial and final results

### Flow

```
Audio Chunk → VAD → StreamingASR → ParaformerStreamingEngine
    ↓
Speech Detected? → Start Utterance
    ↓
Process Chunk → Emit Partial Result
    ↓
Silence Detected? → Finalize → Emit Final Result
```

## Usage

### Basic Streaming

```python
from stt_worker.engines.paraformer.engine import ParaformerStreamingEngine
from stt_worker.streaming_asr import StreamingASR, StreamingConfig

# Initialize engine
engine = ParaformerStreamingEngine({
    "model_dir": r"D:\Models\paraformer-streaming"
})
engine.load()

# Configure streaming
config = StreamingConfig(
    chunk_ms=500,              # Process every 500ms
    endpoint_silence_ms=400,   # End after 400ms silence
    vad_threshold=0.5          # VAD speech threshold
)

# Callbacks
def on_partial(text: str):
    print(f"Partial: {text}")

def on_final(text: str, duration_ms: int):
    print(f"Final: {text} ({duration_ms}ms)")

# Start streaming
asr = StreamingASR(engine, config, on_partial, on_final)

# Process audio chunks
chunk = get_audio_chunk()  # 16kHz float32 audio
vad_score = get_vad_score()
asr.process_chunk(chunk, vad_score)

# Stop and finalize
asr.stop()
```

### Integration with VAD

```python
from stt_worker.vad import SileroVAD

vad = SileroVAD()

# In audio loop:
for chunk in audio_stream:
    vad_score = vad(chunk)
    asr.process_chunk(chunk, vad_score)
```

## Configuration

### StreamingConfig

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `chunk_ms` | int | 500 | Audio chunk duration in milliseconds |
| `endpoint_silence_ms` | int | 400 | Silence duration to detect endpoint |
| `vad_threshold` | float | 0.5 | VAD probability threshold for speech detection |

### ParaformerStreamingEngine Config

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model_dir` | str | `D:\Models\paraformer-streaming` | Path to model files |
| `num_threads` | int | 4 | Number of CPU threads |
| `sample_rate` | int | 16000 | Audio sample rate |
| `feature_dim` | int | 80 | Feature dimension |

## Model Files

The streaming model requires these files in `model_dir`:
- `tokens.txt` - Token vocabulary
- `encoder.onnx` - Encoder model
- `decoder.onnx` - Decoder model
- `joiner.onnx` - Joiner model

## Performance

### Latency
- **Streaming Mode**: 100-300ms (partial results)
- **Batch Mode**: 3-6s (complete utterance)

### Accuracy
- Chinese ASR optimized
- Real-time partial results with progressive refinement

### Resource Usage
- CPU-only (no GPU required)
- ~4 threads recommended
- Low memory footprint

## Protocol Messages

Streaming results are communicated via JSONL protocol:

```json
{"type": "partial", "text": "你好"}
{"type": "final", "text": "你好世界", "duration_ms": 1500}
{"type": "cancel"}
```

## Error Handling

```python
try:
    asr.process_chunk(chunk, vad_score)
except RuntimeError as e:
    # Engine not loaded
    print(f"Error: {e}")
```

## Testing

Run tests:
```bash
.venv/Scripts/python.exe -m pytest tests/python/test_streaming.py -v
```

Integration tests (requires model):
```bash
.venv/Scripts/python.exe -m pytest tests/python/test_streaming.py::TestStreamingIntegration -v
```

## Future Improvements

1. Multi-language support (currently Chinese only)
2. Confidence scores for partial results
3. Word-level timestamps
4. GPU acceleration
5. Online model adaptation

## References

- [sherpa-onnx Documentation](https://github.com/k2-fsa/sherpa-onnx)
- [Paraformer Model](https://github.com/alibaba-damo-academy/FunASR)