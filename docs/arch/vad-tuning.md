# VAD 参数调优指南

> P3-3：silero-vad 延迟 / 准确率权衡，参数从 `config.json` 一路透传到 Python worker。

## 数据流

```
config.json ── stt.vad ──► workerClient.ts:spawnFor()
  ──► python stt_worker/main.py --vad-threshold 0.45 ...
  ──► vad_module.DEFAULT_THRESHOLD = 0.45  (in main.py 启动时)
  ──► vad.is_speech(audio, threshold=None) → 使用 DEFAULT_THRESHOLD
```

## 6 个可调参数

| 参数 | config.json key | CLI flag | 默认 | 说明 |
|---|---|---|---|---|
| 语音概率阈值 | `threshold` | `--vad-threshold` | 0.45 | silero-vad 输出 (0-1)，超过即判语音 |
| 最短语音时长 | `minVoiceMs` | `--vad-min-voice-ms` | 200 | 低于此时长不算有效语音（去短促噪声） |
| 静音 RMS | `silenceRms` | `--vad-silence-rms` | 1e-4 | 能量 fallback：低于此判静音 |
| 有声 RMS | `noiseMaxRms` | `--vad-noise-max-rms` | 1e-2 | 能量 fallback：超过此判有声 |
| 处理块大小 | `chunkMs` | `--vad-chunk-ms` | 32 | 对应 512 样本 @ 16kHz |
| 端点静音时长 | `endpointSilenceMs` | `--vad-endpoint-silence-ms` | 800 | 静音超过此时长触发切分 |

## 基准测试

```bash
# 准备测试音频
cp path/to/your_voice_sample.wav tests/fixtures/sample_voice.wav

# 阈值网格扫描
python scripts/benchmark-vad.py --audio tests/fixtures/sample_voice.wav \
  --thresholds 0.3,0.4,0.45,0.5,0.6,0.7 \
  --output benchmark.csv
```

## 调优建议

### 场景 1：频繁误触发（噪声被识别为语音）

```json
{
  "stt": { "vad": { "threshold": 0.55, "minVoiceMs": 300, "silenceRms": 5e-5, "noiseMaxRms": 5e-3 } }
}
```

### 场景 2：漏检（真实语音被丢弃）

```json
{
  "stt": { "vad": { "threshold": 0.35, "minVoiceMs": 100, "noiseMaxRms": 5e-3 } }
}
```

### 场景 3：端点检测慢（说话停顿了很久才切分）

```json
{
  "stt": { "vad": { "endpointSilenceMs": 400 } }
}
```

### 场景 4：低延迟优先

```json
{
  "stt": { "vad": { "chunkMs": 16, "endpointSilenceMs": 300 } }
}
```

## 性能指标参考

| 音频时长 | chunkMs=32 | chunkMs=16 |
|---|---|---|
| 1s | ~15ms | ~20ms |
| 3s | ~35ms | ~55ms |
| 5s | ~55ms | ~90ms |

## 故障排查

**silero-vad 加载失败**：worker 发 `{"type":"ready","vad":"energy_threshold"}` 表示退化到能量阈值。检查 `~/.voxcode/logs/` 错误日志。

**参数没生效**：检查 `logs/worker.log` 的 `spawning worker` 行应有 `--vad-threshold 0.45 ...` 字样。

**频繁噪声判定**：VAD 判定无语音时发 `noise` 事件。临时降 `threshold` 到 0.3 观察，同时检查麦克风增益。
