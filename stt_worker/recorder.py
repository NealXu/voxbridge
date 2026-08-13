"""sounddevice 流式录音：回调累积 PCM 帧，stop 时拼接返回。"""
import numpy as np
import sounddevice as sd

from stt_worker.vad import SAMPLE_RATE


class Recorder:
    def __init__(self, samplerate: int = SAMPLE_RATE, channels: int = 1):
        self.samplerate = samplerate
        self.channels = channels
        self._frames: list[np.ndarray] = []
        self._stream: sd.InputStream | None = None

    def _callback(self, indata, frames, time, status) -> None:
        self._frames.append(indata.copy())

    def start(self) -> None:
        self._frames = []
        self._stream = sd.InputStream(
            samplerate=self.samplerate,
            channels=self.channels,
            dtype="float32",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> np.ndarray:
        """停止录音，返回 float32 单声道音频（长度 0 表示无帧）。"""
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        if not self._frames:
            return np.zeros(0, dtype="float32")
        return np.concatenate(self._frames).reshape(-1, self.channels).mean(axis=1)
