# 方案 A：目录驱动 (Directory-Driven)

## 概述

**核心思想**：一个目录 = 一个 CC 实例

```
chatId = cwd (工作目录绝对路径)

D:\Projects\my-app      → CC 实例 1
D:\Projects\website     → CC 实例 2
D:\Documents\notes      → CC 实例 3
```

---

## 设计详情

### 数据结构

```typescript
/**
 * 目录驱动的 Session 管理
 */
interface DirectorySessionManager {
  /** 进程池，按目录索引 */
  registry: ExecutorRegistry;
  
  /** 当前活跃目录 */
  activeCwd: string;
  
  /** 已知项目目录（用于智能提示） */
  knownProjects: Set<string>;
}

/**
 * Registry Entry（内部结构）
 */
interface DirectoryEntry {
  /** 目录作为 chatId */
  chatId: string;  // = cwd
  
  /** 持久执行器 */
  executor: PersistentClaudeExecutor;
  
  /** 租约计数 */
  leases: number;
  
  /** 最后使用时间 */
  lastUsedAt: number;
}
```

### chatId 生成规则

```typescript
/**
 * 生成 chatId
 * 简单直接：目录路径作为唯一标识
 */
function generateChatId(cwd: string): string {
  // 规范化路径（统一大小写、分隔符）
  return normalizePath(cwd);
}

function normalizePath(path: string): string {
  // Windows: D:\Projects\MyApp → D:/projects/myapp
  // Unix: /home/user/project → /home/user/project
  return resolve(path)
    .replace(/\\/g, '/')
    .toLowerCase();
}
```

### 目录来源优先级

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CWD 选择优先级                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 语音指定（最高）                                                          │
│     用户："在 D:\Projects\my-app 里帮我..."                                   │
│     → 解析路径，直接使用                                                      │
│                                                                             │
│  2. 命令行参数                                                                │
│     voxbridge --cwd D:\Projects\my-app                                      │
│     → 启动时指定，作为默认目录                                                 │
│                                                                             │
│  3. 配置文件                                                                  │
│     config.json: { "executor": { "cwd": "..." } }                           │
│     → 持久化配置                                                              │
│                                                                             │
│  4. 当前终端目录（默认）                                                       │
│     process.cwd()                                                           │
│     → 启动 VoxBridge 时所在的目录                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 切换目录流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            目录切换流程                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  用户输入："切换到 website 项目"                                               │
│      ↓                                                                      │
│  解析目标目录                                                                 │
│      ├─ 关键词匹配："website" → D:\Projects\website                          │
│      └─ 或：路径提取："D:\Projects\website"                                   │
│      ↓                                                                      │
│  检查目录是否存在                                                              │
│      ├─ 不存在 → 错误提示，保持当前目录                                         │
│      └─ 存在 → 继续                                                          │
│      ↓                                                                      │
│  生成新 chatId                                                               │
│      chatId = "D:/projects/website"                                         │
│      ↓                                                                      │
│  获取/创建 CC 实例                                                            │
│      registry.acquire(chatId, { cwd })                                      │
│      ├─ 已存在 → 复用（零开销）                                               │
│      └─ 不存在 → 创建新进程                                                   │
│      ↓                                                                      │
│  更新 activeCwd                                                              │
│      manager.activeCwd = cwd                                                │
│      ↓                                                                      │
│  提示用户                                                                     │
│      "已切换到 website (D:\Projects\website)"                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 场景示例

### 基础使用流程

```
═══════════════════════════════════════════════════════════════════════════
时间线                          用户操作                    系统响应
═══════════════════════════════════════════════════════════════════════════

[启动]
────────────────────────────────────────────────────────────────────────────
09:00    $ voxbridge --cwd D:\Projects\my-app
         
                                    ┌────────────────────────────────────┐
                                    │ 就绪，按 F9 说话（Ctrl+C 退出）      │
                                    │ 当前项目: my-app                    │
                                    │ CC 实例: 等待首次输入                │
                                    └────────────────────────────────────┘

────────────────────────────────────────────────────────────────────────────
09:01    [按 F9] "添加一个登录页面"
         
                                    ┌────────────────────────────────────┐
                                    │ 🎤 添加一个登录页面                  │
                                    │                                    │
                                    │ [启动 CC 进程 my-app]              │
                                    │                                    │
                                    │ 🔧 Bash: npm install react-router  │
                                    │ 📝 Write: src/pages/Login.tsx      │
                                    │                                    │
                                    │ ✅ 已创建登录页面                   │
                                    └────────────────────────────────────┘
         
         CC 实例状态：
         chatId: "D:\Projects\my-app"
         status: idle (等待下次输入)

────────────────────────────────────────────────────────────────────────────
09:03    [按 F9] "给登录页面添加表单验证"
         
                                    ┌────────────────────────────────────┐
                                    │ 🎤 给登录页面添加表单验证            │
                                    │                                    │
                                    │ [复用 CC 进程 my-app]             │
                                    │ ← 同一实例，上下文保持               │
                                    │                                    │
                                    │ ✅ 已添加表单验证                   │
                                    └────────────────────────────────────┘
         
         注：没有进程创建开销，直接复用

────────────────────────────────────────────────────────────────────────────
09:05    [按 F9] "切换到 website 项目"
         
                                    ┌────────────────────────────────────┐
                                    │ 🎤 切换到 website 项目              │
                                    │                                    │
                                    │ ✅ 已切换到 website                 │
                                    │    D:\Projects\website              │
                                    │                                    │
                                    │ [启动新 CC 进程 website]           │
                                    └────────────────────────────────────┘
         
         my-app 进程保持运行，等待下次切换

────────────────────────────────────────────────────────────────────────────
09:06    [按 F9] "更新首页标题"
         
                                    ┌────────────────────────────────────┐
                                    │ 🎤 更新首页标题                      │
                                    │                                    │
                                    │ [使用 CC 进程 website]            │
                                    │                                    │
                                    │ ✅ 已更新首页标题                   │
                                    └────────────────────────────────────┘

────────────────────────────────────────────────────────────────────────────
09:08    [按 F9] "回到 my-app"
         
                                    ┌────────────────────────────────────┐
                                    │ 🎤 回到 my-app                      │
                                    │                                    │
                                    │ ✅ 已切换到 my-app                  │
                                    │                                    │
                                    │ [复用 CC 进程 my-app]             │
                                    │ ← 进程仍在运行，瞬间切换             │
                                    │ ← 会话上下文保持                    │
                                    └────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════
```

### 多终端并行实例

```
═══════════════════════════════════════════════════════════════════════════
                        多终端窗口并行运行（进程隔离策略）
═══════════════════════════════════════════════════════════════════════════

┌─ 终端 1 ────────────────────────────────────────────────────────────────┐
│                                                                         │
│  D:\Projects\my-app> voxbridge                                          │
│                                                                         │
│  CC 实例：                                                              │
│  - chatId: "D:\Projects\my-app"                                        │
│  - 进程 PID: 12345                                                      │
│  - sessionId: sess_abc123                                              │
│                                                                         │
│  用户 A 独立使用                                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─ 终端 2 ────────────────────────────────────────────────────────────────┐
│                                                                         │
│  D:\Projects\website> voxbridge                                         │
│                                                                         │
│  CC 实例：                                                              │
│  - chatId: "D:\Projects\website"                                       │
│  - 进程 PID: 23456                                                      │
│  - sessionId: sess_def456                                              │
│                                                                         │
│  用户 B 独立使用                                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

说明：
- 每个 VoxBridge 进程有独立的 ExecutorRegistry
- 不同终端的 CC 进程完全隔离
- 不会互相干扰
- 资源占用更多，但实现简单可靠
```

### 错误处理：进程崩溃

```
═══════════════════════════════════════════════════════════════════════════

[CC 进程崩溃]
────────────────────────────────────────────────────────────────────────────
         
         [按 F9] "帮我重构整个项目"
         
                                    ┌────────────────────────────────────┐
                                    │ ❌ CC 进程崩溃！                    │
                                    │    Error: 内存不足                  │
                                    │    已自动清理                       │
                                    └────────────────────────────────────┘
         
         系统自动处理：
         1. 检测到 CC 进程退出（非正常）
         2. 从 Registry 中移除失效条目
         3. 显示错误信息

────────────────────────────────────────────────────────────────────────────
         [按 F9] "重试"
         
                                    ┌────────────────────────────────────┐
                                    │ 🎤 重试                             │
                                    │                                    │
                                    │ [重新创建 CC 进程 my-app]         │
                                    │ ← 新进程，新 session                │
                                    │                                    │
                                    │ ⚠️  上次会话上下文已丢失            │
                                    └────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════
```

### 错误处理：网络问题

```
═══════════════════════════════════════════════════════════════════════════

[网络错误]
────────────────────────────────────────────────────────────────────────────
         
         [按 F9] "分析代码"
         
                                    ┌────────────────────────────────────┐
                                    │ ❌ 网络错误！                       │
                                    │    Connection timeout              │
                                    │                                    │
                                    │ CC 进程保持运行                     │
                                    │ 可以直接重试                        │
                                    └────────────────────────────────────┘
         
         区别：
         - 网络错误：进程存活，上下文保持，可直接重试
         - 进程崩溃：进程退出，上下文丢失，需重新创建

────────────────────────────────────────────────────────────────────────────
         [按 F9] "重试"
         
                                    ┌────────────────────────────────────┐
                                    │ 🎤 重试                             │
                                    │                                    │
                                    │ [复用 CC 进程]                     │
                                    │ ← 同一进程，上下文保持              │
                                    │                                    │
                                    │ ✅ 分析完成                         │
                                    └────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════
```

### 会话持久化

```
═══════════════════════════════════════════════════════════════════════════

[Day 1]
────────────────────────────────────────────────────────────────────────────
         
         使用 my-app 项目
         
         持久化文件：
         ~/.voxbridge/sessions/D__Projects_my-app.json
         {
           "chatId": "D:\\Projects\\my-app",
           "sessionId": "sess_abc123",
           "lastUsedAt": "2026-08-15T15:30:00Z"
         }

────────────────────────────────────────────────────────────────────────────
         Ctrl+C 退出 VoxBridge
         
         系统处理：
         1. 保存 session ID 到文件
         2. 关闭 CC 进程
         3. 清理资源

[Day 2]
────────────────────────────────────────────────────────────────────────────
         
         $ voxbridge --cwd D:\Projects\my-app
         
                                    ┌────────────────────────────────────┐
                                    │ [启动检测]                          │
                                    │ 发现历史 session 文件               │
                                    │ sessionId: sess_abc123              │
                                    │ age: 17.5 小时                      │
                                    │                                    │
                                    │ ✓ SDK 确认 session 仍可用           │
                                    └────────────────────────────────────┘
         
         [按 F9] "继续上次的登录页面"
         
                                    ┌────────────────────────────────────┐
                                    │ [恢复 session sess_abc123]        │
                                    │ ← 复用 CC 会话，上下文保持          │
                                    │                                    │
                                    │ ✅ 继续登录页面开发                 │
                                    └────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════
```

---

## 优缺点分析

### 优点

| # | 优点 | 说明 |
|---|------|------|
| 1 | **概念简单** | 一个项目一个实例，用户容易理解 |
| 2 | **上下文隔离** | 不同项目的对话自动隔离 |
| 3 | **零切换开销** | 切回已存在的目录瞬间完成 |
| 4 | **自动化管理** | idle 超时自动回收，无需用户干预 |
| 5 | **多终端支持** | 每个终端独立运行，互不干扰 |

### 缺点

| # | 缺点 | 缓解措施 |
|---|------|----------|
| 1 | 同一目录只能有一个 session | 升级到方案 B（命名 Session） |
| 2 | 切换目录需要显式操作 | 支持语音切换 + MRU 历史 |
| 3 | 多进程资源占用 | idleTimeoutMs 自动回收 |

---

## 实现要点

### 核心代码结构

```typescript
// src/session/directorySessionManager.ts

import { ExecutorRegistry, PersistentClaudeExecutor } from "../executor/index.js";

export class DirectorySessionManager {
  private registry: ExecutorRegistry;
  private activeCwd: string;
  private knownProjects: Set<string> = new Set();
  
  constructor(config: Config) {
    this.registry = new ExecutorRegistry({
      idleTimeoutMs: config.executor?.idleTimeoutMs ?? 1800000,
      maxConcurrent: config.executor?.maxConcurrent ?? 5,
    });
    this.activeCwd = process.cwd();
  }
  
  /**
   * 获取当前活跃的执行器
   */
  async acquire(): Promise<RegistryEntry> {
    const chatId = this.generateChatId(this.activeCwd);
    return this.registry.acquire(chatId, { cwd: this.activeCwd });
  }
  
  /**
   * 释放当前执行器
   */
  async release(reason: string): Promise<void> {
    const chatId = this.generateChatId(this.activeCwd);
    await this.registry.release(chatId, reason);
  }
  
  /**
   * 切换目录
   */
  async switchDirectory(newCwd: string): Promise<SwitchResult> {
    // 1. 检查目录是否存在
    if (!existsSync(newCwd)) {
      return { ok: false, error: "directory_not_found" };
    }
    
    // 2. 释放当前目录的租约
    await this.release("switching directory");
    
    // 3. 更新活跃目录
    this.activeCwd = newCwd;
    this.knownProjects.add(newCwd);
    
    // 4. 获取/创建新目录的执行器
    const chatId = this.generateChatId(newCwd);
    const entry = await this.registry.acquire(chatId, { cwd: newCwd });
    
    return { ok: true, entry };
  }
  
  /**
   * 生成 chatId
   */
  private generateChatId(cwd: string): string {
    return resolve(cwd).replace(/\\/g, '/').toLowerCase();
  }
}
```

### 语音指令解析

```typescript
// src/session/directoryParser.ts

/**
 * 解析用户输入中的目录切换指令
 */
export function parseDirectorySwitch(input: string): DirectorySwitch | null {
  const patterns = [
    // "切换到 D:\Projects\my-app"
    /切换到\s+(.+)/,
    // "在 D:\Projects\my-app 里..."
    /在\s+(.+?)\s+里/,
    // "回到 my-app"
    /回到\s+(.+)/,
    // "用 website 项目"
    /用\s+(.+?)\s+项目/,
  ];
  
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return {
        type: "switch",
        target: match[1].trim(),
        original: input,
      };
    }
  }
  
  return null;
}

/**
 * 将关键词解析为目录路径
 */
export function resolveDirectoryKeyword(
  keyword: string,
  knownProjects: Set<string>
): string | null {
  // 1. 检查是否是绝对路径
  if (isAbsolute(keyword) && existsSync(keyword)) {
    return keyword;
  }
  
  // 2. 检查已知项目
  for (const project of knownProjects) {
    const name = basename(project);
    if (name.toLowerCase() === keyword.toLowerCase()) {
      return project;
    }
  }
  
  // 3. 检查是否是相对路径
  const relativePath = resolve(process.cwd(), keyword);
  if (existsSync(relativePath)) {
    return relativePath;
  }
  
  return null;
}
```

---

## 配置项

```json
{
  "executor": {
    "mode": "sdk",
    "persistent": true,
    "idleTimeoutMs": 1800000,   // 30 分钟
    "maxConcurrent": 5,
    "cwd": null                  // 默认目录，null 表示使用启动目录
  }
}
```

---

## 适用场景

- ✅ 个人开发者，项目数量有限
- ✅ 每个项目只需要一个长期会话
- ✅ 需要简单可靠的方案
- ❌ 需要同一项目多个独立会话 → 使用方案 B