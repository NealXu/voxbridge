# STT 引擎 Fallback 机制

> v2.1 新增 — 主引擎失败时自动切换到备用引擎。

## 架构

```
config.json
  └─► stt.engine = "sensevoice-onnx"
  └─► stt.fallback = "whisper"
        │
        ▼
  src/stt/workerClient.ts
  └─► spawnFor() 透传 --engine 和 --fallback 参数
        │
        ▼
  stt_worker/main.py
  └─► EngineFactory.initialize(engine, fallback)
        ├─ 加载主引擎 (sensevoice-onnx)
        │  ├─ 成功 → 使用主引擎
        │  └─ 失败 → 尝试备用引擎 (whisper)
        │            ├─ 成功 → 发送 ready (engine=fallback)
        │            └─ 失败 → 发送 error 并退出
        └─ 发送 ready 事件，包含引擎名称和能力声明
```

## 配置

```jsonc
{
  "stt": {
    "engine": "sensevoice-onnx",    // 主引擎
    "fallback": "whisper",          // 备用引擎（可选）
    "model_dir": "D:\\Models\\sensevoice-onnx",
    "model": "sensevoice-onnx"
  }
}
```

**参数说明：**

| 参数 | 类型 | 说明 |
|---|---|---|
| `engine` | string | 主引擎名称：`whisper`、`sensevoice-onnx`、`paraformer` |
| `fallback` | string? | 备用引擎名称（可选），主引擎失败时自动切换 |
| `model_dir` | string | 模型文件目录 |
| `model` | string | 模型标识（引擎相关） |

## 可用引擎

| 引擎 | 名称 | 模型大小 | 特点 |
|---|---|---|---|
| **SenseVoice ONNX** | `sensevoice-onnx` | ~150MB | 阿里 SenseVoice，中文优化，ONNX 推理 |
| **Whisper** | `whisper` | large-v3: ~3GB | faster-whisper，多语言通用 |
| **Paraformer** | `paraformer` | - | 阿里 Paraformer（开发中） |

## Fallback 场景

### 场景 1：主引擎模型缺失

```
配置：engine=sensevoice-onnx, fallback=whisper
模型状态：sensevoice-onnx 目录不存在，whisper 已下载

流程：
  1. 尝试加载 sensevoice-onnx → FileNotFoundError
  2. 自动切换到 whisper
  3. 加载成功，发送 ready 事件
  4. 日志：[INFO] Primary engine failed, trying fallback: whisper
```

### 场景 2：主引擎依赖缺失

```
配置：engine=sensevoice-onnx, fallback=whisper
依赖状态：sherpa-onnx 未安装

流程：
  1. 尝试导入 sherpa_onnx → ImportError
  2. 自动切换到 whisper
  3. 加载成功
```

### 场景 3：两个引擎都失败

```
配置：engine=sensevoice-onnx, fallback=whisper
模型状态：两个模型都不存在

流程：
  1. 尝试 sensevoice-onnx → FileNotFoundError
  2. 尝试 whisper → FileNotFoundError
  3. 发送 {"type": "error", "message": "Both primary and fallback engines failed"}
  4. 退出（exit code 1）
```

## 日志与调试

**启动成功（主引擎）：**
```
[INFO] Created engine instance: sensevoice-onnx
[INFO] Initialized engine: sensevoice-onnx
```

**Fallback 切换：**
```
[WARN] Primary engine failed, trying fallback: whisper
[INFO] Created engine instance: whisper
[INFO] Loaded fallback engine: whisper
```

**全部失败：**
```
[ERROR] Failed to create engine: sensevoice-onnx
[ERROR] Both primary and fallback engines failed. Primary: No ONNX model found
```

## 代码实现

**Node 端（workerClient.ts）：**

```typescript
// 透传引擎参数给 Python worker
const args = [
  "stt_worker/main.py",
  "--model", stt.model,
  "--model-dir", stt.model_dir,
  "--language", stt.language,
];
if (stt.engine) args.push("--engine", stt.engine);
if (stt.fallback) args.push("--fallback", stt.fallback);
```

**Python 端（main.py）：**

```python
# 初始化引擎工厂
factory = EngineFactory(engine_config)
success, message = factory.initialize(args.engine, config=engine_config, fallback=args.fallback)

if not success:
    emit({"type": "error", "message": f"Failed to initialize engine: {message}"})
    sys.exit(1)

# 获取引擎实例
engine = factory.get_engine()
```

**引擎工厂（factory.py）：**

```python
def initialize(self, engine_name: str, config: dict, fallback: str = None) -> Tuple[bool, str]:
    # 创建并加载主引擎
    self._current_engine = self.create_engine(engine_name, config)
    if not self._current_engine.load():
        # 主引擎失败，尝试备用引擎
        if fallback:
            self._fallback_engine = self.create_engine(fallback, fallback_config)
            if self._fallback_engine.load():
                return True, f"Loaded fallback engine: {fallback}"
        return False, f"Failed to load engine: {error}"
    return True, f"Initialized engine: {engine_name}"
```

## 验证

### 单元测试

`tests/stt/` 目录下的测试覆盖：

- 引擎参数正确透传
- Fallback 切换逻辑
- 全部失败时的错误处理

### 手动验证

```powershell
# 1. 正常启动（主引擎成功）
npm start
# 预期：日志显示 "Initialized engine: sensevoice-onnx"

# 2. 模拟主引擎失败（重命名模型目录）
Rename-Item "D:\Models\sensevoice-onnx" "D:\Models\sensevoice-onnx.bak"
npm start
# 预期：日志显示 "Loaded fallback engine: whisper"

# 3. 恢复
Rename-Item "D:\Models\sensevoice-onnx.bak" "D:\Models\sensevoice-onnx"
```

## 故障排查

**问题：Fallback 不生效**

检查：
- `config.json` 中 `stt.fallback` 是否配置
- 备用引擎的模型是否已下载

**问题：两个引擎都失败**

检查：
- `stt_worker/engines/` 目录结构是否完整
- Python 依赖是否安装（sherpa-onnx、faster-whisper）

**问题：切换后识别效果差**

说明：不同引擎的识别质量有差异。SenseVoice ONNX 对中文优化更好；Whisper 通用性强但中文质量稍低。

---

**最后更新**：2026-08-16