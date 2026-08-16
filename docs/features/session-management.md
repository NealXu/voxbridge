# Session 管理

## 功能概述

Session 管理模块负责 CC（Claude Code）进程的生命周期管理，支持持久进程池、进程复用、目录切换等功能。

## 目录驱动模式

**核心思想：** 一个目录 = 一个 CC 实例

```
D:\Projects\my-app      → CC 实例 1 (chatId: d:/projects/my-app)
D:\Projects\website     → CC 实例 2 (chatId: d:/projects/website)
D:\Documents\notes      → CC 实例 3 (chatId: d:/documents/notes)
```

## 配置项

```json
{
  "executor": {
    "mode": "sdk",
    "persistent": true,
    "idleTimeoutMs": 1800000,
    "maxConcurrent": 5
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| persistent | boolean | false | 启用持久进程池 |
| idleTimeoutMs | number | 1800000 | 空闲超时（毫秒），默认 30 分钟 |
| maxConcurrent | number | 5 | 最大并发进程数 |

## 使用示例

### 启动

```powershell
cd D:\Projects\my-app
npm start
```

日志输出：
```
[main] using persistent session manager idleTimeoutMs=1800000 maxConcurrent=5
[main] VoxBridge starting uiMode=console triggerKey=F9
```

### 多次输入复用进程

```
[按 F9] "你好"
→ CC 响应，创建进程

[按 F9] "帮我列出文件"
→ CC 响应，复用同一进程（无启动开销）
```

**验证：** 任务列表中 CC 进程 PID 保持不变。

### 多终端并行

```powershell
# 终端 1
cd D:\Projects\app-a
npm start

# 终端 2
cd D:\Projects\app-b
npm start
```

每个 VoxBridge 实例有独立的进程池，互不干扰。

## 进程复用机制

### acquire/release 流程

```
用户输入
    ↓
session.send(prompt)
    ↓
sessionManager.acquire()
    ↓
registry.acquire(chatId, { cwd })
    ├─ 已存在 → 复用（零开销）
    └─ 不存在 → 创建新进程
    ↓
executor.nextTurn(prompt)
    ↓
CC 响应
    ↓
sessionManager.release("turn complete")
```

### chatId 生成

```typescript
function generateChatId(cwd: string): string {
  return resolve(cwd)
    .replace(/\\/g, '/')
    .toLowerCase();
}
```

- Windows: `D:\Projects\MyApp` → `d:/projects/myapp`
- Unix: `/home/user/project` → `/home/user/project`

## 空闲超时

当进程空闲超过 `idleTimeoutMs` 后自动回收：

```
release("turn complete")
    ↓
启动空闲计时器 (idleTimeoutMs)
    ↓
超时触发 → dispose 进程 → 释放资源
```

**默认值：** 1800000ms（30 分钟）

## 错误处理

### 进程崩溃

```
CC 进程崩溃
    ↓
registry 检测到进程退出
    ↓
从 Map 中移除条目
    ↓
下次 acquire 自动创建新进程
```

### 网络错误

```
API 调用失败
    ↓
进程保持运行
    ↓
可直接重试（上下文保持）
```

## 优雅退出

按 `Ctrl+C` 退出 VoxBridge：

```
SIGINT 信号
    ↓
sessionManager.shutdown()
    ↓
registry.shutdownAll("shutdown")
    ↓
所有 CC 进程 dispose
    ↓
VoxBridge 退出
```

**验证：** 退出后无孤儿 CC 进程残留。

## 日志事件

| 事件 | 说明 |
|------|------|
| `using persistent session manager` | 持久模式启动 |
| `acquire` | 获取执行器 |
| `release` | 释放执行器 |
| `executor disposed` | 进程回收 |
| `SIGINT received, shutting down` | 优雅退出 |

## 相关文档

- [架构设计](../architecture/cc-process-persistence.md)
- [用户指南](../guides/user-guide.md)
- [历史设计](../archive/2026-08-16-session-strategies/)
