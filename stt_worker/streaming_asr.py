"""Streaming ASR manager with VAD integration."""
import numpy as np
from typing import Callable, Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class StreamingConfig:
    """Configuration for streaming ASR."""
    chunk_ms: int = 500              # Processing chunk size
    endpoint_silence_ms: int = 400   # Endpoint detection threshold
    vad_threshold: float = 0.5       # VAD speech probability threshold


class StreamingASR:
    """Manages streaming ASR with VAD gating.

    Flow:
    1. VAD detects speech → start utterance
    2. Process chunks → emit partial results
    3. Silence detected → finalize utterance
    4. Emit final result
    """

    def __init__(
        self,
        engine,  # ParaformerStreamingEngine
        config: StreamingConfig,
        on_partial: Callable[[str], None],
        on_final: Callable[[str, int], None],
    ):
        self.engine = engine
        self.config = config
        self.on_partial = on_partial
        self.on_final = on_final

        self._is_speaking = False
        self._silence_duration_ms = 0
        self._audio_buffer = []

    def process_chunk(self, chunk: np.ndarray, vad_score: float) -> None:
        """Process audio chunk with VAD score.

        Args:
            chunk: Audio chunk (float32, 16kHz)
            vad_score: VAD speech probability (0-1)
        """
        is_speech = vad_score > self.config.vad_threshold

        if is_speech:
            if not self._is_speaking:
                # Start new utterance
                self.engine.start_utterance()
                self._is_speaking = True
                self._audio_buffer = []
                logger.debug("Started new utterance")

            self._audio_buffer.append(chunk)
            self._silence_duration_ms = 0

            # Get partial result
            partial = self.engine.accept_chunk(chunk)
            if partial:
                self.on_partial(partial)

        else:
            if self._is_speaking:
                self._silence_duration_ms += self.config.chunk_ms

                # Endpoint detection
                if self._silence_duration_ms >= self.config.endpoint_silence_ms:
                    logger.debug(f"Endpoint detected after {self._silence_duration_ms}ms silence")
                    self._finalize()

    def _finalize(self) -> None:
        """Finalize current utterance."""
        if not self._is_speaking:
            return

        text = self.engine.end_utterance()
        total_ms = len(self._audio_buffer) * self.config.chunk_ms

        if text:
            logger.info(f"Final result: {text} ({total_ms}ms)")
            self.on_final(text, total_ms)

        self._is_speaking = False
        self._silence_duration_ms = 0
        self._audio_buffer = []

    def cancel(self) -> None:
        """Cancel current utterance."""
        if self._is_speaking:
            logger.debug("Cancelled utterance")
            self.engine.end_utterance()  # Discard result
            self._is_speaking = False
            self._silence_duration_ms = 0
            self._audio_buffer = []

    def stop(self) -> None:
        """Stop and finalize."""
        if self._is_speaking:
            self._finalize()