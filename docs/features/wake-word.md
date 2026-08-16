# 唤醒词贯通

> ~~P3-2~~ ✅ — "你好小助" 语音触发，替代按键说话。

## 架构

```
config.stt.wakeWord = "你好小助"
  └─► workerClient.spawnFor(): 透传 --wake-word "你好小助"
       └─► stt_worker/main.py 启动后台线程 run_wake_loop()
            ├─ Recorder.start_persistent(): 持续录音 + 100ms 块分发
            ├─ 累积 VAD 有效段（≥1.5s）→ whisper-tiny 识别
            ├─ match_wake_word(text) → 匹配 → emit({"type":"wake"})
            └─ 冷却 2s 防抖

       Node 端 dispatch wake 事件 → onWake() 回调
       └─► WakeWordTrigger.start() → cb.onStartListening()
            └─► main.ts 开始录音 → 松开后识别 → agent 调用
```

## 关键机制

### 1. 双模型

- **生产模型**（large-v3）：用户实际指令转写（~3GB）
- **唤醒词模型**（tiny）：后台持续识别，`Systran/faster-whisper-tiny`（~40MB）首次自动下载

### 2. 累积识别

chunk 100ms 太短，累积 VAD 有效段 ≥1.5s 后送 whisper-tiny 识别，匹配则 `emit({"type":"wake"})`。

### 3. 冷却防抖

唤醒后 2 秒内不再重复触发，避免连续误唤醒。

### 4. 按键模式并存

唤醒词模式与按键模式共用 worker，按键命令照常工作，唤醒词仅额外启动后台线程。

## 验证

`tests/wakeEvent.test.ts`（5 个）+ `tests/trigger.wakeword.test.ts`（3 个）= 8 个 wake 测试。

手动：`stt.wakeWord="你好小助"` + `trigger.wakeWord.enabled=true` → 重启 → 对麦说唤醒词 → 状态变 "🎙 录音中…"。

## 故障排查

**唤醒不灵敏**：降 `vad.threshold` 到 0.35；提高麦克风增益。

**首次启动慢**：whisper-tiny 下载需网络。失败发 `error` 事件。

**按键模式下仍触发**：`stt.wakeWord` 控制 worker；`trigger.wakeWord.enabled` 控制 trigger 选择。二者都需设置。
