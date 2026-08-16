# ASR 引擎升级实施计划

**日期**: 2026-08-16
**目标**: 将 VoxBridge 的 ASR 引擎从 faster-whisper 升级到 SenseVoice，支持多引擎切换、流式识别，最终可编译为独立二进制

---

## 目录

1. [现状分析](#1-现状分析)
2. [升级路线图](#2-升级路线图)
3. [阶段一：SenseVoice 集成](#3-阶段一sensevoice-集成)
4. [阶段二：多引擎架构](#4-阶段二多引擎架构)
5. [阶段三：流式识别](#5-阶段三流式识别)
6. [阶段四：独立二进制](#6-阶段四独立二进制)
7. [文件结构规划](#7-文件结构规划)
8. [风险与缓解](#8-风险与缓解)
9. [时间估算](#9-时间估算)

---

## 1. 现状分析

### 当前架构

```
stt_worker/
├── main.py              # 入口，硬编码 WhisperEngine
├── whisper_engine.py    # faster-whisper large-v3
├── recorder.py          # 音频录制
├── vad.py               # silero-vad 语音活动检测
├── protocol.py          # JSONL 通信协议
└── wakeword.py          # 唤醒词检测
```

### 当前配置

```json
{
  "stt": {
    "model": "large-v3",
    "model_dir": "D:\\Models\\faster-whisper-large-v3",
    "device": "cpu",
    "language": "zh"
  }
}
```

### 痛点

| 问题 | 当前值 | 目标值 |
|------|--------|--------|
| 模型体积 | ~3GB (large-v3) | ~230MB (SenseVoice) |
| 转写延迟 | 3-6 秒 | < 500ms |
| 中文准确率 | 良好 | 优秀（阿里专项优化） |
| 附加功能 | 无 | ITN、情绪检测、声音事件 |
| 流式支持 | 无 | 实时部分结果 |

---

## 2. 升级路线图

```
阶段一                阶段二              阶段三              阶段四
SenseVoice集成   →   多引擎架构    →    流式识别      →    独立二进制
(1-2天)              (2-3天)             (3-5天)             (5-7天)
                                                                
● 下载模型           ● 引擎基类          ● Paraformer流式    ● Nuitka打包
● FunASR集成         ● 引擎工厂          ● VAD集成           ● C++二进制
● sherpa-onnx集成    ● 配置驱动          ● 部分结果          ● 分发方案
● 基准测试           ● 热切换            ● 编辑处理          ● 体积优化
```

---

## 3. 阶段一：SenseVoice 集成

### 3.1 模型下载

**下载源**（推荐 ModelScope 国内源）：

```powershell
# 方法一：使用 ModelScope CLI
pip install modelscope
modelscope download --model iic/SenseVoiceSmall --local_dir D:\Models\SenseVoiceSmall

# 方法二：使用 HuggingFace CLI
pip install huggingface_hub
huggingface-cli download FunAudioLLM/SenseVoiceSmall --local-dir D:\Models\SenseVoiceSmall

# 方法三：sherpa-onnx ONNX 版本（推荐用于部署）
huggingface-cli download csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17 --local-dir D:\Models\sensevoice-onnx
```

**模型文件说明**：

| 格式 | 大小 | 用途 |
|------|------|------|
| PyTorch (.pt) | ~400MB | FunASR SDK、训练 |
| ONNX (.onnx) | ~230MB | sherpa-onnx、边缘部署 |
| ONNX INT8 | ~60-80MB | 移动端/嵌入式 |

### 3.2 FunASR 集成

**安装依赖**：

```powershell
pip install funasr
pip install modelscope  # 用于自动下载
```

**实现代码** (`stt_worker/engines/sensevoice_engine.py`)：

```python
"""SenseVoice engine implementation via FunASR."""
import time
import numpy as np
from typing import Tuple


class SenseVoiceEngine:
    """SenseVoice ASR engine using FunASR SDK."""
    
    def __init__(self, model_path: str = "iic/SenseVoiceSmall", device: str = "cpu"):
        self.model_path = model_path
        self.device = device
        self._model = None
    
    def load(self) -> None:
        """Load SenseVoice model."""
        from funasr import AutoModel
        
        self._model = AutoModel(
            model=self.model_path,
            device=self.device,
            trust_remote_code=True,
        )
    
    def transcribe(self, audio: np.ndarray, language: str = "auto") -> Tuple[str, int]:
        """
        Transcribe audio.
        
        Args:
            audio: float32, 16kHz, mono
            language: "auto", "zh", "en", "ja", "ko", "yue"
        
        Returns:
            (text, duration_ms)
        """
        if self._model is None:
            raise RuntimeError("SenseVoiceEngine.load() must be called first")
        
        start = time.monotonic()
        
        result = self._model.generate(
            input=audio,
            language=language,
            use_itn=True,  # 数字归一化："一百二十三" → "123"
            batch_size=1,
        )
        
        text = result[0]["text"] if result else ""
        duration_ms = int((time.monotonic() - start) * 1000)
        
        return text, duration_ms
    
    def transcribe_with_metadata(self, audio: np.ndarray) -> dict:
        """Transcribe with emotion and event detection."""
        from funasr import AutoModel
        
        model = AutoModel(
            model=self.model_path,
            vad_model="fsmn-vad",
            punc_model="ct-punc-c",
            trust_remote_code=True,
        )
        
        result = model.generate(
            input=audio,
            language="auto",
            use_itn=True,
        )
        
        return {
            "text": result[0].get("text", ""),
            "timestamps": result[0].get("timestamps", []),
            "emotion": result[0].get("emotion", "unknown"),
            "event": result[0].get("event", "unknown"),
        }
```

### 3.3 sherpa-onnx 集成

**安装**：

```powershell
pip install sherpa-onnx
```

**实现代码** (`stt_worker/engines/sensevoice_onnx_engine.py`)：

```python
"""SenseVoice engine via sherpa-onnx (faster, better for deployment)."""
import time
import numpy as np
from typing import Tuple


class SenseVoiceOnnxEngine:
    """SenseVoice using sherpa-onnx for deployment."""
    
    def __init__(self, model_dir: str, num_threads: int = 4):
        self.model_dir = model_dir
        self.num_threads = num_threads
        self._recognizer = None
    
    def load(self) -> None:
        """Load ONNX model."""
        import sherpa_onnx
        
        # Find model files
        from pathlib import Path
        model_path = Path(self.model_dir)
        
        # For SenseVoice ONNX
        model_file = list(model_path.glob("*.onnx"))[0]
        tokens_file = model_path / "tokens.txt"
        
        self._recognizer = sherpa_onnx.OfflineRecognizer(
            model=str(model_file),
            tokens=str(tokens_file),
            num_threads=self.num_threads,
            sample_rate=16000,
            decoding_method="greedy_search",
        )
    
    def transcribe(self, audio: np.ndarray, language: str = "auto") -> Tuple[str, int]:
        """Transcribe audio."""
        if self._recognizer is None:
            raise RuntimeError("SenseVoiceOnnxEngine.load() must be called first")
        
        start = time.monotonic()
        
        stream = self._recognizer.create_stream()
        stream.accept_waveform(16000, audio)
        self._recognizer.decode_stream(stream)
        
        result = stream.result
        text = result.text
        duration_ms = int((time.monotonic() - start) * 1000)
        
        return text, duration_ms
```

### 3.4 基准测试

**测试脚本** (`scripts/benchmark_sensevoice.py`)：

```python
"""Benchmark SenseVoice vs Whisper performance."""
import time
import numpy as np
import soundfile as sf
from pathlib import Path


def benchmark_engine(engine, audio: np.ndarray, runs: int = 5):
    """Run benchmark for an engine."""
    # Warmup
    engine.transcribe(audio)
    
    # Benchmark
    times = []
    for _ in range(runs):
        _, duration = engine.transcribe(audio)
        times.append(duration)
    
    avg_ms = sum(times) / len(times)
    audio_duration_s = len(audio) / 16000
    rtf = (avg_ms / 1000) / audio_duration_s
    
    return {
        "avg_ms": avg_ms,
        "rtf": rtf,
        "audio_duration_s": audio_duration_s,
    }


def main():
    # Load test audio
    audio, sr = sf.read("test_audio.wav", dtype="float32")
    if sr != 16000:
        import librosa
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
    
    print(f"Audio duration: {len(audio)/16000:.2f}s")
    print()
    
    # Benchmark Whisper
    print("=== Whisper large-v3 ===")
    from stt_worker.whisper_engine import WhisperEngine
    whisper = WhisperEngine(r"D:\Models\faster-whisper-large-v3")
    whisper.load()
    result = benchmark_engine(whisper, audio)
    print(f"Avg latency: {result['avg_ms']:.0f}ms")
    print(f"RTF: {result['rtf']:.3f}")
    print()
    
    # Benchmark SenseVoice (FunASR)
    print("=== SenseVoice (FunASR) ===")
    from stt_worker.engines.sensevoice_engine import SenseVoiceEngine
    sensevoice = SenseVoiceEngine()
    sensevoice.load()
    result = benchmark_engine(sensevoice, audio)
    print(f"Avg latency: {result['avg_ms']:.0f}ms")
    print(f"RTF: {result['rtf']:.3f}")
    print()
    
    # Benchmark SenseVoice (sherpa-onnx)
    print("=== SenseVoice (sherpa-onnx) ===")
    from stt_worker.engines.sensevoice_onnx_engine import SenseVoiceOnnxEngine
    sensevoice_onnx = SenseVoiceOnnxEngine(r"D:\Models\sensevoice-onnx")
    sensevoice_onnx.load()
    result = benchmark_engine(sensevoice_onnx, audio)
    print(f"Avg latency: {result['avg_ms']:.0f}ms")
    print(f"RTF: {result['rtf']:.3f}")


if __name__ == "__main__":
    main()
```

**预期性能对比**：

| 引擎 | 模型大小 | RTF (CPU) | 延迟 |
|------|----------|-----------|------|
| Whisper large-v3 | ~3GB | 0.5-1.0 | 3-6s |
| SenseVoice FunASR | ~400MB | 0.03-0.05 | 200-500ms |
| SenseVoice sherpa-onnx | ~230MB | 0.05-0.08 | 300-600ms |

### 3.5 阶段一检查清单

- [ ] 下载 SenseVoice 模型到 `D:\Models\SenseVoiceSmall`
- [ ] 下载 ONNX 版本到 `D:\Models\sensevoice-onnx`
- [ ] 实现 `SenseVoiceEngine` (FunASR)
- [ ] 实现 `SenseVoiceOnnxEngine` (sherpa-onnx)
- [ ] 运行基准测试脚本
- [ ] 对比准确率和延迟
- [ ] 更新 config.json 添加引擎选择

---

## 4. 阶段二：多引擎架构

### 4.1 架构设计

```
stt_worker/
├── engines/                    # 新增：引擎插件系统
│   ├── __init__.py
│   ├── base.py                 # 引擎抽象基类
│   ├── factory.py              # 引擎工厂 & 注册表
│   ├── config.py               # 引擎配置 schema
│   │
│   ├── whisper/                # Whisper 引擎
│   │   ├── __init__.py
│   │   └── engine.py
│   │
│   ├── sensevoice/             # SenseVoice 引擎
│   │   ├── __init__.py
│   │   └── engine.py
│   │
│   ├── paraformer/             # Paraformer 引擎
│   │   ├── __init__.py
│   │   └── engine.py
│   │
│   └── dummy/                  # 测试用虚拟引擎
│       ├── __init__.py
│       └── engine.py
│
├── main.py                     # 修改：使用引擎工厂
└── ... (其他文件不变)
```

### 4.2 引擎基类 (`engines/base.py`)

```python
"""Abstract base class for all STT engines."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Optional
import numpy as np


class EngineState(Enum):
    UNLOADED = "unloaded"
    LOADING = "loading"
    READY = "ready"
    ERROR = "error"


@dataclass
class EngineInfo:
    name: str
    version: str
    description: str
    supported_languages: list[str]
    supports_streaming: bool = False
    requires_gpu: bool = False


@dataclass
class TranscriptionResult:
    text: str
    duration_ms: int
    language: Optional[str] = None
    confidence: Optional[float] = None


class EngineBase(ABC):
    """Abstract base class for all STT engines."""
    
    @classmethod
    @abstractmethod
    def get_info(cls) -> EngineInfo:
        ...
    
    @classmethod
    @abstractmethod
    def get_default_config(cls) -> dict:
        ...
    
    def __init__(self, config: dict):
        self._config = config
        self._state = EngineState.UNLOADED
        self._error: Optional[str] = None
    
    @property
    def state(self) -> EngineState:
        return self._state
    
    @abstractmethod
    def load(self) -> bool:
        ...
    
    @abstractmethod
    def unload(self) -> None:
        ...
    
    @abstractmethod
    def transcribe(self, audio: np.ndarray, language: str = "zh") -> TranscriptionResult:
        ...
```

### 4.3 引擎工厂 (`engines/factory.py`)

```python
"""Engine factory and registry."""
from typing import Optional, Type
import importlib
import logging
from pathlib import Path

from .base import EngineBase, EngineState

logger = logging.getLogger(__name__)


class EngineRegistry:
    """Registry for available STT engines."""
    
    _engines: dict[str, Type[EngineBase]] = {}
    
    @classmethod
    def register(cls, engine_class: Type[EngineBase]) -> None:
        info = engine_class.get_info()
        cls._engines[info.name.lower()] = engine_class
        logger.info(f"Registered engine: {info.name}")
    
    @classmethod
    def get(cls, name: str) -> Optional[Type[EngineBase]]:
        return cls._engines.get(name.lower())
    
    @classmethod
    def list_engines(cls) -> list[str]:
        return list(cls._engines.keys())
    
    @classmethod
    def auto_discover(cls) -> None:
        """Auto-discover engines from engines/ subdirectories."""
        engines_dir = Path(__file__).parent
        for subdir in engines_dir.iterdir():
            if subdir.is_dir() and not subdir.name.startswith('_'):
                engine_file = subdir / "engine.py"
                if engine_file.exists():
                    try:
                        module = importlib.import_module(
                            f"stt_worker.engines.{subdir.name}.engine"
                        )
                        for attr_name in dir(module):
                            attr = getattr(module, attr_name)
                            if (isinstance(attr, type) and 
                                issubclass(attr, EngineBase) and 
                                attr is not EngineBase):
                                cls.register(attr)
                                break
                    except Exception as e:
                        logger.warning(f"Failed to load engine from {subdir}: {e}")


class EngineFactory:
    """Factory for creating and managing engine instances."""
    
    def __init__(self, config: dict):
        self._config = config
        self._current_engine: Optional[EngineBase] = None
    
    def create_engine(self, name: str, config: Optional[dict] = None) -> Optional[EngineBase]:
        engine_class = EngineRegistry.get(name)
        if engine_class is None:
            return None
        if config is None:
            config = engine_class.get_default_config()
        return engine_class(config)
    
    def initialize(self, primary: str, fallback: Optional[str] = None) -> tuple[bool, str]:
        """Initialize with fallback support."""
        # Try primary
        self._current_engine = self.create_engine(primary)
        if self._current_engine and self._current_engine.load():
            return True, f"Loaded '{primary}'"
        
        # Try fallback
        if fallback:
            self._current_engine = self.create_engine(fallback)
            if self._current_engine and self._current_engine.load():
                return True, f"Fallback to '{fallback}'"
        
        return False, "No engine could be loaded"
    
    def get_engine(self) -> Optional[EngineBase]:
        return self._current_engine
    
    def switch_engine(self, name: str) -> tuple[bool, str]:
        """Hot-swap engine at runtime."""
        new_engine = self.create_engine(name)
        if new_engine is None:
            return False, f"Engine '{name}' not found"
        
        if new_engine.load():
            if self._current_engine:
                self._current_engine.unload()
            self._current_engine = new_engine
            return True, f"Switched to '{name}'"
        
        return False, f"Failed to load '{name}'"
```

### 4.4 配置 Schema (`engines/config.py`)

```python
"""Engine configuration using Pydantic."""
from pydantic import BaseModel, Field
from typing import Optional, Any


class WhisperConfig(BaseModel):
    model_dir: str = r"D:\Models\faster-whisper-large-v3"
    device: str = "cpu"
    compute_type: str = "int8"


class SenseVoiceConfig(BaseModel):
    model_path: str = "iic/SenseVoiceSmall"
    device: str = "cpu"
    use_itn: bool = True


class ParaformerConfig(BaseModel):
    model_path: str = "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
    device: str = "cpu"
    punctuation: bool = True


class EngineSelectionConfig(BaseModel):
    primary: str = "whisper"
    fallback: Optional[str] = None
    primary_config: Optional[dict[str, Any]] = None
    fallback_config: Optional[dict[str, Any]] = None


class STTConfig(BaseModel):
    engine: EngineSelectionConfig = Field(default_factory=EngineSelectionConfig)
    allow_hot_swap: bool = False
```

### 4.5 修改 main.py

```python
"""STT worker entry point with multi-engine support."""
import argparse
import json
import sys

from stt_worker.protocol import decode, encode
from stt_worker.recorder import Recorder
from stt_worker.vad import has_voice
from stt_worker.engines.factory import EngineFactory, EngineRegistry


def emit(msg: dict) -> None:
    sys.stdout.write(encode(msg))
    sys.stdout.flush()


def main() -> None:
    # Auto-discover engines
    EngineRegistry.auto_discover()
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config/stt_config.json")
    parser.add_argument("--engine", default=None)
    args = parser.parse_args()
    
    # Load config
    with open(args.config) as f:
        config = json.load(f)
    
    # Initialize factory
    factory = EngineFactory(config)
    primary = args.engine or config.get("engine", {}).get("primary", "whisper")
    fallback = config.get("engine", {}).get("fallback")
    
    success, message = factory.initialize(primary, fallback)
    if not success:
        emit({"type": "error", "message": message})
        sys.exit(1)
    
    engine = factory.get_engine()
    emit({"type": "ready", "engine": engine.get_info().name})
    
    # Main loop
    recorder = None
    
    for line in sys.stdin:
        msg = decode(line.strip())
        
        if msg["type"] == "start":
            recorder = Recorder()
            recorder.start()
            emit({"type": "recording"})
        
        elif msg["type"] == "stop":
            audio = recorder.stop() if recorder else None
            recorder = None
            
            if audio is None or not has_voice(audio):
                emit({"type": "noise"})
            else:
                result = engine.transcribe(audio)
                if result.text:
                    emit({"type": "result", "text": result.text, "duration_ms": result.duration_ms})
                else:
                    emit({"type": "noise"})
        
        elif msg["type"] == "switch":
            if config.get("allow_hot_swap"):
                success, msg = factory.switch_engine(msg["engine"])
                emit({"type": "switch_result", "success": success, "message": msg})
                if success:
                    engine = factory.get_engine()
        
        elif msg["type"] == "quit":
            break
    
    engine.unload()


if __name__ == "__main__":
    main()
```

### 4.6 配置文件示例 (`config/stt_config.json`)

```json
{
  "engine": {
    "primary": "sensevoice",
    "fallback": "whisper",
    "primary_config": {
      "model_path": "iic/SenseVoiceSmall",
      "device": "cpu",
      "use_itn": true
    },
    "fallback_config": {
      "model_dir": "D:\\Models\\faster-whisper-large-v3",
      "device": "cpu",
      "compute_type": "int8"
    }
  },
  "allow_hot_swap": true
}
```

### 4.7 阶段二检查清单

- [ ] 创建 `engines/` 目录结构
- [ ] 实现 `EngineBase` 抽象基类
- [ ] 实现 `EngineRegistry` 和 `EngineFactory`
- [ ] 重构 `WhisperEngine` 适配新接口
- [ ] 实现 `SenseVoiceEngine`
- [ ] 实现 `ParaformerEngine`（预留）
- [ ] 实现 `DummyEngine` 用于测试
- [ ] 修改 `main.py` 使用工厂模式
- [ ] 添加热切换协议消息
- [ ] 编写单元测试

---

## 5. 阶段三：流式识别

### 5.1 流式 vs 非流式对比

| 特性 | 非流式（当前） | 流式（目标） |
|------|----------------|--------------|
| 延迟 | 3-6秒 | 100-300ms |
| 部分结果 | 无 | 实时逐词 |
| 内存 | 处理完整语句 | 滚动缓冲区 |
| 准确率 | 更高（完整上下文） | 略低（有限上下文） |
| 适用场景 | 命令控制 | 听写、实时字幕 |

### 5.2 流式架构

```
┌─────────────┐     ┌───────────┐     ┌──────────────┐     ┌─────────┐
│  Microphone │────▶│    VAD    │────▶│  Streaming   │────▶│  Result │
│  (32ms)     │     │  (gating) │     │    ASR       │     │  Output │
└─────────────┘     └───────────┘     └──────────────┘     └─────────┘
                                              │
                                              ▼
                                        ┌──────────┐
                                        │ Partial  │
                                        │ Results  │
                                        └──────────┘
```

### 5.3 Paraformer 流式引擎

**模型下载**：

```powershell
# Paraformer streaming model
huggingface-cli download csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09 --local-dir D:\Models\paraformer-streaming
```

**实现代码** (`stt_worker/engines/paraformer/engine.py`)：

```python
"""Paraformer streaming engine via sherpa-onnx."""
import numpy as np
from typing import Callable, Optional
from ..base import EngineBase, EngineInfo, EngineState, TranscriptionResult


class ParaformerStreamingEngine(EngineBase):
    """Paraformer streaming engine for real-time ASR."""
    
    @classmethod
    def get_info(cls) -> EngineInfo:
        return EngineInfo(
            name="paraformer",
            version="1.0.0",
            description="Alibaba Paraformer streaming via sherpa-onnx",
            supported_languages=["zh"],
            supports_streaming=True,
            requires_gpu=False,
        )
    
    @classmethod
    def get_default_config(cls) -> dict:
        return {
            "model_dir": r"D:\Models\paraformer-streaming",
            "num_threads": 4,
            "sample_rate": 16000,
            "feature_dim": 80,
        }
    
    def __init__(self, config: dict):
        super().__init__(config)
        self._recognizer = None
        self._stream = None
    
    def load(self) -> bool:
        if self._state == EngineState.READY:
            return True
        
        self._state = EngineState.LOADING
        try:
            import sherpa_onnx
            from pathlib import Path
            
            model_dir = Path(self._config["model_dir"])
            
            self._recognizer = sherpa_onnx.OnlineRecognizer(
                tokens=str(model_dir / "tokens.txt"),
                encoder=str(model_dir / "encoder.onnx"),
                decoder=str(model_dir / "decoder.onnx"),
                joiner=str(model_dir / "joiner.onnx"),
                num_threads=self._config.get("num_threads", 4),
                sample_rate=self._config.get("sample_rate", 16000),
                feature_dim=self._config.get("feature_dim", 80),
                decoding_method="greedy_search",
            )
            
            self._state = EngineState.READY
            return True
        except Exception as e:
            self._set_error(str(e))
            return False
    
    def start_utterance(self) -> None:
        """Start a new utterance stream."""
        if self._recognizer is None:
            raise RuntimeError("Engine not loaded")
        self._stream = self._recognizer.create_stream()
    
    def accept_chunk(self, chunk: np.ndarray) -> Optional[str]:
        """Process audio chunk, return partial result if available."""
        if self._stream is None:
            raise RuntimeError("Call start_utterance() first")
        
        self._stream.accept_waveform(
            self._config.get("sample_rate", 16000),
            chunk
        )
        
        while self._recognizer.is_ready(self._stream):
            self._recognizer.decode_stream(self._stream)
        
        result = self._recognizer.get_result(self._stream)
        return result.text if result else None
    
    def end_utterance(self) -> str:
        """End utterance and get final result."""
        if self._stream is None:
            return ""
        
        self._stream.input_finished()
        
        while self._recognizer.is_ready(self._stream):
            self._recognizer.decode_stream(self._stream)
        
        result = self._recognizer.get_result(self._stream)
        self._stream = None
        
        return result.text if result else ""
    
    def unload(self) -> None:
        self._recognizer = None
        self._stream = None
        self._state = EngineState.UNLOADED
    
    def transcribe(self, audio: np.ndarray, language: str = "zh") -> TranscriptionResult:
        """Non-streaming transcription (for compatibility)."""
        import time
        start = time.monotonic()
        
        self.start_utterance()
        self.accept_chunk(audio)
        text = self.end_utterance()
        
        duration_ms = int((time.monotonic() - start) * 1000)
        return TranscriptionResult(text=text, duration_ms=duration_ms)
```

### 5.4 流式 ASR 管理器

**实现代码** (`stt_worker/streaming_asr.py`)：

```python
"""Streaming ASR manager with VAD integration."""
import numpy as np
from typing import Callable, Optional
from dataclasses import dataclass


@dataclass
class StreamingConfig:
    chunk_ms: int = 500          # Processing chunk size
    endpoint_silence_ms: int = 400  # Endpoint detection threshold
    vad_threshold: float = 0.5


class StreamingASR:
    """Manages streaming ASR with VAD gating."""
    
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
        self._chunk_duration_ms = config.chunk_ms
        self._audio_buffer = []
    
    def process_chunk(self, chunk: np.ndarray, vad_score: float) -> None:
        """Process audio chunk with VAD score."""
        is_speech = vad_score > self.config.vad_threshold
        
        if is_speech:
            if not self._is_speaking:
                # Start new utterance
                self.engine.start_utterance()
                self._is_speaking = True
                self._audio_buffer = []
            
            self._audio_buffer.append(chunk)
            self._silence_duration_ms = 0
            
            # Get partial result
            partial = self.engine.accept_chunk(chunk)
            if partial:
                self.on_partial(partial)
        
        else:
            if self._is_speaking:
                self._silence_duration_ms += self._chunk_duration_ms
                
                # Endpoint detection
                if self._silence_duration_ms >= self.config.endpoint_silence_ms:
                    self._finalize()
    
    def _finalize(self) -> None:
        """Finalize current utterance."""
        if not self._is_speaking:
            return
        
        text = self.engine.end_utterance()
        total_ms = len(self._audio_buffer) * self._chunk_duration_ms
        
        if text:
            self.on_final(text, total_ms)
        
        self._is_speaking = False
        self._silence_duration_ms = 0
        self._audio_buffer = []
    
    def cancel(self) -> None:
        """Cancel current utterance."""
        if self._is_speaking:
            self.engine.end_utterance()  # Discard result
            self._is_speaking = False
            self._silence_duration_ms = 0
            self._audio_buffer = []
    
    def stop(self) -> None:
        """Stop and finalize."""
        if self._is_speaking:
            self._finalize()
```

### 5.5 修改协议

**新增协议消息**：

```python
# 流式结果
{"type": "partial", "text": "你好"}

# 最终结果（带时长）
{"type": "final", "text": "你好世界", "duration_ms": 1500}

# 取消
{"type": "cancel"}
```

### 5.6 配置更新

```json
{
  "stt": {
    "mode": "streaming",
    "streaming": {
      "chunk_ms": 500,
      "endpoint_silence_ms": 400,
      "partial_results": true
    }
  }
}
```

### 5.7 阶段三检查清单

- [ ] 下载 Paraformer streaming 模型
- [ ] 实现 `ParaformerStreamingEngine`
- [ ] 实现 `StreamingASR` 管理器
- [ ] 集成 VAD 门控
- [ ] 添加部分结果回调
- [ ] 实现端点检测
- [ ] 添加取消机制
- [ ] 更新协议消息
- [ ] 流式基准测试
- [ ] UI 集成（显示部分结果）

---

## 6. 阶段四：独立二进制

### 6.1 方案对比

| 方案 | 性能 | 体积 | 开发难度 | 推荐场景 |
|------|------|------|----------|----------|
| **Nuitka 打包** | 1.5x 提升 | 50-100MB | 低 | 快速分发 |
| **PyInstaller** | 基线 | 80-150MB | 低 | 快速原型 |
| **C++ 原生二进制** | 最佳 | 5-20MB | 高 | 生产部署 |

### 6.2 方案一：Nuitka 打包（推荐）

**安装**：

```powershell
pip install nuitka
```

**编译命令**：

```powershell
python -m nuitka --standalone --onefile `
    --enable-plugin=numpy `
    --follow-imports `
    --include-data-dir=stt_worker=stt_worker `
    --include-data-dir=models=models `
    --output-dir=dist `
    --output-filename=voxbridge.exe `
    src/main.py
```

**体积优化**：

```powershell
python -m nuitka --standalone --onefile `
    --enable-plugin=numpy `
    --nofollow-import-to=tkinter `
    --nofollow-import-to=matplotlib `
    --remove-output `
    --output-dir=dist `
    src/main.py
```

### 6.3 方案二：C++ 原生二进制

**步骤**：

1. **静态编译 sherpa-onnx**：

```powershell
# 克隆并编译
git clone https://github.com/k2-fsa/sherpa-onnx.git
cd sherpa-onnx
mkdir build && cd build

cmake -G "Visual Studio 17 2022" -A x64 `
    -DBUILD_SHARED_LIBS=OFF `
    -DSHERPA_ONNX_ENABLE_PYTHON=OFF `
    -DSHERPA_ONNX_ENABLE_TESTS=OFF `
    ..

cmake --build . --config Release
```

2. **编写 C++ 应用**：

```cpp
#include "sherpa-onnx/c-api/c-api.h"
#include <iostream>
#include <vector>

int main() {
    // 配置
    SherpaOnnxOfflineRecognizerConfig config;
    config.model = "models/sensevoice.onnx";
    config.tokens = "models/tokens.txt";
    config.num_threads = 4;
    config.sample_rate = 16000;
    
    // 创建识别器
    auto recognizer = CreateOfflineRecognizer(&config);
    
    // 创建流
    auto stream = CreateOfflineStream(recognizer);
    
    // 读取音频（示例）
    std::vector<float> audio = ReadAudioFile("input.wav");
    
    // 识别
    AcceptWaveform(stream, 16000, audio.data(), audio.size());
    DecodeOfflineStream(recognizer, stream);
    
    // 获取结果
    auto result = GetOfflineStreamResult(stream);
    std::cout << "Text: " << result->text << std::endl;
    
    // 清理
    DestroyOfflineRecognizerResult(result);
    DestroyOfflineStream(stream);
    DestroyOfflineRecognizer(recognizer);
    
    return 0;
}
```

3. **编译**：

```powershell
cl /std:c++17 /I sherpa-onnx/include voxbridge.cpp `
   /link sherpa-onnx.lib onnxruntime.lib `
   /OUT:dist/voxbridge.exe
```

### 6.4 模型分发

**方案 A：外部模型文件**（推荐）

```
dist/
├── voxbridge.exe
└── models/
    ├── sensevoice.onnx (230MB)
    └── tokens.txt
```

**方案 B：嵌入模型**（单文件）

```powershell
# 转换为 C 数组
xxd -i sensevoice.onnx > model_data.h

# 编译时嵌入
cl /std:c++17 voxbridge_with_model.cpp /OUT:voxbridge-standalone.exe
```

### 6.5 体积优化

**INT8 量化**：

```python
# 使用 onnxruntime 量化
from onnxruntime.quantization import quantize_dynamic, QuantType

quantize_dynamic(
    "sensevoice.onnx",
    "sensevoice_int8.onnx",
    weight_type=QuantType.QInt8
)
```

**效果**：

| 指标 | FP32 | INT8 | 改善 |
|------|------|------|------|
| 模型大小 | 230MB | 60MB | 74% 减少 |
| 准确率 | 基线 | -0.5% | 可接受 |
| CPU 速度 | 1x | 2-3x | 显著提升 |

### 6.6 分发方案

**便携版**：

```
voxbridge-portable.zip
├── voxbridge.exe
├── models/
├── config.json
└── README.txt
```

**安装版**（Inno Setup）：

```iss
[Files]
Source: "dist\voxbridge.exe"; DestDir: "{app}"
Source: "models\*"; DestDir: "{app}\models"; Flags: recursesubdirs

[Icons]
Name: "{group}\VoxBridge"; Filename: "{app}\voxbridge.exe"
```

### 6.7 许可证检查

| 组件 | 许可证 | 商业可用 |
|------|--------|----------|
| sherpa-onnx | Apache 2.0 | ✅ |
| ONNX Runtime | MIT | ✅ |
| SenseVoice | Apache 2.0 | ✅ |
| Paraformer | Apache 2.0 | ✅ |
| Whisper | MIT | ✅ |

### 6.8 阶段四检查清单

- [ ] 测试 Nuitka 打包
- [ ] 优化打包体积
- [ ] 静态编译 sherpa-onnx
- [ ] 编写 C++ 原型
- [ ] INT8 量化模型
- [ ] 创建便携版分发包
- [ ] 创建安装版（可选）
- [ ] 许可证合规检查
- [ ] 跨平台测试（Windows 10/11）

---

## 7. 文件结构规划

### 最终目录结构

```
voxbridge/
├── stt_worker/
│   ├── engines/
│   │   ├── __init__.py
│   │   ├── base.py                 # EngineBase, EngineInfo, TranscriptionResult
│   │   ├── factory.py              # EngineRegistry, EngineFactory
│   │   ├── config.py               # Pydantic config schemas
│   │   │
│   │   ├── whisper/
│   │   │   ├── __init__.py
│   │   │   └── engine.py           # WhisperEngine
│   │   │
│   │   ├── sensevoice/
│   │   │   ├── __init__.py
│   │   │   ├── engine.py           # SenseVoiceEngine (FunASR)
│   │   │   └── onnx_engine.py      # SenseVoiceOnnxEngine (sherpa-onnx)
│   │   │
│   │   ├── paraformer/
│   │   │   ├── __init__.py
│   │   │   └── engine.py           # ParaformerStreamingEngine
│   │   │
│   │   └── dummy/
│   │       ├── __init__.py
│   │       └── engine.py           # DummyEngine (testing)
│   │
│   ├── streaming_asr.py            # StreamingASR manager
│   ├── main.py                     # Updated entry point
│   ├── protocol.py                 # JSONL protocol
│   ├── recorder.py                 # Audio recording
│   ├── vad.py                      # VAD detection
│   └── wakeword.py                 # Wake word detection
│
├── config/
│   ├── stt_config.json             # STT configuration
│   └── config.example.json         # Example config template
│
├── models/                         # Local models (gitignored)
│   ├── SenseVoiceSmall/
│   ├── sensevoice-onnx/
│   └── paraformer-streaming/
│
├── scripts/
│   ├── benchmark_sensevoice.py     # Benchmark script
│   ├── download_models.py          # Model download helper
│   └── build_binary.ps1            # Build script for binary
│
├── dist/                           # Build output (gitignored)
│   ├── voxbridge.exe
│   └── models/
│
└── tests/
    ├── test_engines.py
    ├── test_factory.py
    └── test_streaming.py
```

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| SenseVoice 中文识别不如预期 | 高 | 保留 Whisper 作为 fallback |
| sherpa-onnx Windows 兼容问题 | 中 | 优先使用 FunASR Python SDK |
| 流式识别延迟仍高 | 中 | 调整 chunk 大小，考虑 GPU |
| Nuitka 打包失败 | 中 | 回退到 PyInstaller |
| 模型体积仍然大 | 低 | 使用 INT8 量化 |
| 内存占用过高 | 中 | 模型按需加载，及时卸载 |

---

## 9. 时间估算

| 阶段 | 任务 | 预计时间 |
|------|------|----------|
| **阶段一** | SenseVoice 集成 | 1-2 天 |
| | - 模型下载和验证 | 2 小时 |
| | - FunASR 集成 | 3 小时 |
| | - sherpa-onnx 集成 | 3 小时 |
| | - 基准测试 | 2 小时 |
| **阶段二** | 多引擎架构 | 2-3 天 |
| | - 架构设计和实现 | 8 小时 |
| | - 重构现有代码 | 4 小时 |
| | - 测试和文档 | 4 小时 |
| **阶段三** | 流式识别 | 3-5 天 |
| | - Paraformer 流式引擎 | 6 小时 |
| | - StreamingASR 管理器 | 8 小时 |
| | - VAD 集成和调优 | 6 小时 |
| | - UI 集成 | 4 小时 |
| **阶段四** | 独立二进制 | 5-7 天 |
| | - Nuitka 打包 | 4 小时 |
| | - C++ 原型（可选） | 16 小时 |
| | - 模型优化 | 4 小时 |
| | - 分发和安装 | 8 小时 |
| **总计** | | **11-17 天** |

---

## 附录

### A. 参考链接

- [SenseVoice GitHub](https://github.com/FunAudioLLM/SenseVoice)
- [FunASR GitHub](https://github.com/alibaba/FunASR)
- [sherpa-onnx GitHub](https://github.com/k2-fsa/sherpa-onnx)
- [sherpa-onnx 文档](https://k2-fsa.github.io/sherpa/onnx/)
- [ModelScope SenseVoice](https://modelscope.cn/models/iic/SenseVoiceSmall)

### B. 模型下载命令速查

```powershell
# SenseVoice PyTorch (FunASR)
modelscope download --model iic/SenseVoiceSmall --local_dir D:\Models\SenseVoiceSmall

# SenseVoice ONNX (sherpa-onnx)
huggingface-cli download csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17 --local-dir D:\Models\sensevoice-onnx

# Paraformer streaming
huggingface-cli download csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09 --local-dir D:\Models\paraformer-streaming
```

### C. 性能基准预期

| 引擎 | 模型大小 | RTF (CPU) | 延迟 | 内存 |
|------|----------|-----------|------|------|
| Whisper large-v3 | 3GB | 0.5-1.0 | 3-6s | 4GB |
| SenseVoice FunASR | 400MB | 0.03-0.05 | 200-500ms | 1.5GB |
| SenseVoice ONNX | 230MB | 0.05-0.08 | 300-600ms | 1GB |
| SenseVoice INT8 | 60MB | 0.08-0.12 | 400-800ms | 0.6GB |
| Paraformer streaming | 200MB | 实时 | 100-300ms | 0.8GB |
