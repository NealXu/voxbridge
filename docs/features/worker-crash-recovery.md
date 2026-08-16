# Worker 崩溃恢复
> ~~P1-1~~ ✅ — worker 进程异常退出，验证自动重启与 3 次上限退出。

## 架构

```
main.ts                       workerClient.ts
  ┌──────────────────┐        ┌────────────────────┐
  │ handleWorkerExit │◄────── │ child.on("exit")   │
  │  ├─ log.error    │        │  ├─ 非故意退出才触发 │
  │  ├─ lastStderr[] │        │  └─ intentionalExit 标记
  │  ├─ 指数回退 1→2→4s       └────────────────────┘
  │  ├─ stt.dispose()│
  │  └─ createSttClient()
  └──────────────────┘
```

## 关键机制

### 1. stderr 捕获

`spawnFor` 改为 `stdio: ["pipe", "pipe", "pipe"]`，stderr 按行分发给 `onStderrLine`。

`main.ts` 维护环形缓冲（最多 20 行），崩溃时截取最后 5 行写入日志：

```typescript
log.error("worker crashed", { consecutiveCrashes, lastStderr });
```

### 2. 指数回退

```
第 1 次崩溃：1s 后重启
第 2 次崩溃：2s 后重启
第 3 次崩溃：fatal exit（不再重启）
```

回退上限 30s，避免在持续故障下快速消耗 CPU。

### 3. 旧 client 清理

`handleWorkerExit` 在创建新 client 前先 `await stt.dispose()`，确保旧 worker 子进程被回收，避免 `python.exe` 僵尸进程。

### 4. 3 次上限

`consecutiveCrashes >= 3` 触发 `process.exit(1)` + fatal 日志。成功 ready 后计数器归零。

## 验证

### 手动验证（需要真实模型）

```powershell
# 编译
npx tsc

# 崩溃 1 次（应重启）
.\scripts\simulate-worker-crash.ps1 -CrashCount 1

# 崩溃 3 次（应退出）
.\scripts\simulate-worker-crash.ps1 -CrashCount 3
```

### 自动化测试

`tests/workerCrashRecovery.test.ts` 覆盖：

- `onExit` 回调在意外退出时触发
- `dispose()` 后不触发 `onExit`
- ready 前 / ready 后崩溃都触发回调
- 连续 3 次崩溃退出应该生效
- 成功 ready 后计数器重置

### 日志查看

崩溃事件写入 `~/.VoxBridge/logs/YYYY-MM-DD.log`。

```
[2026-08-15T10:30:45.123Z] [ERROR   ] [main       ] worker crashed consecutiveCrashes=1 lastStderr=["Traceback ...", "MemoryError"]
[2026-08-15T10:30:46.200Z] [INFO    ] [main       ] spawning worker pythonPath=... args=...
```

## 故障排查

**僵尸 python.exe**：说明 `dispose()` 未成功回收。检查日志中 `worker exit` 事件，`intentional` 应为 true。

**重启卡住**：检查 `waitReady` 60s 超时是否命中。可能是模型加载失败，看 `lastStderr`。

**3 次连续崩溃**：通常是模型损坏或 OOM。看 fatal 日志中 `lastStderr`，必要时重建模型目录（重新下载）。
