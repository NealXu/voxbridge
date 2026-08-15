"""sounddevice 流式录音：回调累积 PCM 帧，stop 时拼接返回。

新增持续模式（for 唤醒词）：start_persistent() 启动后台音频线程，
通过 audio_chunks 队列按块分发，供唤醒词循环消费；stop_persistent() 停止。
"""
import numpy as np
import sounddevice as sd
from queue import Queue

from stt_worker.vad import SAMPLE_RATE


class Recorder:
    def __init__(self, samplerate: int = SAMPLE_RATE, channels: int = 1):
        self.samplerate = samplerate
        self.channels = channels
        self._frames: list[np.ndarray] = []
        self._stream: sd.InputStream | None = None
        # 持续模式状态
        self._audio_chunks: Queue[np.ndarray] = Queue(maxsize=200)
        self._persistent_stream: sd.InputStream | None = None
        self._stop_persistent = False

    def _callback(self, indata, frames, time, status) -> None:
        self._frames.append(indata.copy())

    def _persistent_callback(self, indata, frames, time, status) -> None:
        """持续模式回调：把单声道块推入 queue，满则丢弃最旧的。"""
        mono = indata.copy().reshape(-1, self.channels).mean(axis=1)
        try:
            self._audio_chunks.put_nowait(mono)
        except Exception:
            # queue 满时丢弃最旧的，保证不阻塞 audio 线程
            try:
                self._audio_chunks.get_nowait()
                self._audio_chunks.put_nowait(mono)
            except Exception:
                pass

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

    def start_persistent(self, chunk_samples: int = 1600) -> None:
        """启动持续录音模式（每 chunk_samples 样本一块，默认 100ms @ 16kHz）。"""
        self._stop_persistent = False
        # 清空残留块
        while not self._audio_chunks.empty():
            try:
                self._audio_chunks.get_nowait()
            except Exception:
                break
        blocksize = chunk_samples
        self._persistent_stream = sd.InputStream(
            samplerate=self.samplerate,
            channels=self.channels,
            dtype="float32",
            blocksize=blocksize,
            callback=self._persistent_callback,
        )
        self._persistent_stream.start()

    def stop_persistent(self) -> None:
        """停止持续模式。"""
        self._stop_persistent = True
        if self._persistent_stream is not None:
            self._persistent_stream.stop()
            self._persistent_stream.close()
            self._persistent_stream = None

    def get_audio_chunk(self, timeout: float = 0.1) -> np.ndarray | None:
        """从持续模式队列取一块音频；超时返回 None。"""
        try:
            return self._audio_chunks.get(timeout=timeout)
        except Exception:
            return None
