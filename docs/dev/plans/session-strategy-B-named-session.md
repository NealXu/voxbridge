# 方案 B：命名 Session (Named Session)

## 概述

**核心思想**：用户命名 session，每个 session 有独立的 CWD 和上下文

```
chatId = name@cwd

"api-重构@D:\Projects\my-app"   → CC 实例 1
"ui-优化@D:\Projects\my-app"    → CC 实例 2
"docs@D:\Projects\website"      → CC 实例 3
```

**关键特性**：同一目录可以有多个独立 session

---

## 设计详情

### 数据结构

```typescript
/**
 * 命名 Session 管理
 */
interface NamedSessionManager {
  /** 进程池 */
  registry: ExecutorRegistry;
  
  /** 当前活跃 session */
  activeSession: SessionRef | null;
  
  /** 所有 session 引用 */
  sessions: Map<string, SessionRef>;
  
  /** 目录到 session 的映射（一个目录可有多个 session） */
  directorySessions: Map<string, Set<string>>;
}

/**
 * Session 引用
 */
interface SessionRef {
  /** 唯一标识（name@cwd 格式） */
  chatId: string;
  
  /** 用户命名的 session 名 */
  name: string;
  
  /** 工作目录 */
  cwd: string;
  
  /** 创建时间 */
  createdAt: number;
  
  /** 最后使用时间 */
  lastUsedAt: number;
  
  /** CC session ID（SDK 提供） */
  ccSessionId?: string;
  
  /** 用户备注（可选） */
  description?: string;
}
```

### chatId 生成规则

```typescript
/**
 * 生成 chatId
 * 格式：name@cwd
 */
function generateChatId(name: string, cwd: string): string {
  const normalizedCwd = normalizePath(cwd);
  const safeName = sanitizeName(name);
  return `${safeName}@${normalizedCwd}`;
}

/**
 * 名称安全化：只允许字母、数字、下划线、连字符
 */
function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}
```

---

## 场景示例

### 同一目录多 Session

```
═══════════════════════════════════════════════════════════════════════════

场景：my-app 项目有多个并行任务
────────────────────────────────────────────────────────────────────────────

┌─────────────────────────────────────────────────────────────────────────────┐
│  D:\Projects\my-app                                                         │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │ api-重构            │  │ ui-优化             │  │ bugfix-auth         │ │
│  │                     │  │                     │  │                     │ │
│  │ 独立 CC 进程        │  │ 独立 CC 进程        │  │ 独立 CC 进程        │ │
│  │ 独立上下文          │  │ 独立上下文          │  │ 独立上下文          │ │
│  │ 独立 session ID     │  │ 独立 session ID     │  │ 独立 session ID     │ │
│  │                     │  │                     │  │                     │ │
│  │ 上次：重构 API      │  │ 上次：优化 UI       │  │ 上次：修复 auth bug │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘ │
│                                                                             │
│  用户可以自由切换，每个 session 保持独立的对话上下文                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

用户操作示例：
────────────────────────────────────────────────────────────────────────────

14:20  [按 F9] "用 api-重构，继续重构 user API"     → 使用 session 1
14:25  [按 F9] "切换到 ui-优化"                      → 切换到 session 2
14:26  [按 F9] "继续优化样式"                        → 使用 session 2
14:30  [按 F9] "切换到 bugfix-auth"                  → 切换到 session 3
14:35  [按 F9] "回到 api-重构"                       → 切换回 session 1
       → 上下文保持：之前的 API 重构进度

═══════════════════════════════════════════════════════════════════════════
```

---

## 优缺点

### 优点

- ✅ 同一目录多会话
- ✅ 语义化命名
- ✅ 上下文完全隔离
- ✅ 支持并行工作

### 缺点

- ❌ 用户需记住 session 名
- ❌ 管理复杂度增加
- ❌ 更多资源占用

---

## 适用场景

- ✅ 同一项目需要多个并行任务
- ✅ 用户习惯给任务命名
- ✅ 需要完全隔离的上下文
- ❌ 简单场景 → 使用方案 A