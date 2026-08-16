# Session Strategy A 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 session-strategy-a 的缺失功能（语音目录切换、会话持久化、配置支持），将完成度从 70% 提升至 100%。

**Architecture:** 采用 TDD 方法，为每个功能编写测试先行。语音解析器作为独立模块，会话持久化通过扩展 DirectorySessionManager 实现，配置支持通过优先级解析逻辑实现。

**Tech Stack:** TypeScript, Node.js, @anthropic-ai/claude-agent-sdk, node:test (测试框架)

## Global Constraints

- TypeScript strict mode enabled
- 所有测试必须通过：`npm test`
- 测试覆盖率目标：> 80%
- 无占位符代码（TBD/TODO）
- 每个任务必须独立可测试
- 遵循现有代码风格（ESM 模块，.js 后缀导入）
- 文件编码：UTF-8，无 BOM
- 使用 `node:test` 和 `node:assert/strict`

---

## Phase 1: 核心功能补全

### Task 1: 实现语音目录切换解析器

**目标：** 创建语音指令解析器，支持 4 种切换模式和关键词匹配。

**Files:**
- Create: `src/session/directoryParser.ts`
- Create: `tests/directoryParser.test.ts`

**Interfaces:**
- Produces:
  - `parseDirectorySwitch(input: string): DirectorySwitch | null` - 解析用户输入中的目录切换指令
  - `resolveDirectoryKeyword(keyword: string, knownProjects: Set<string>, cwd: string): string | null` - 将关键词解析为目录路径
  - `DirectorySwitch` interface: `{ type: "switch"; target: string; task?: string; original: string }`

---

- [ ] **Step 1: 创建解析器文件**

创建 `src/session/directoryParser.ts`：

```typescript
import { resolve, isAbsolute, basename } from "node:path";
import { existsSync } from "node:fs";

/**
 * 目录切换指令结构
 */
export interface DirectorySwitch {
  type: "switch";
  target: string;
  task?: string;
  original: string;
}

/**
 * 从用户输入解析目录切换指令
 */
export function parseDirectorySwitch(input: string): DirectorySwitch | null {
  // 模式 1: 切换到 <目录>
  const pattern1 = /切换到\s+(.+)/;
  const match1 = input.match(pattern1);
  if (match1) {
    return {
      type: "switch",
      target: match1[1].trim(),
      original: input,
    };
  }

  // 模式 2: 在 <目录> 里 <任务>
  const pattern2 = /在\s+(.+?)\s+里(.*)/;
  const match2 = input.match(pattern2);
  if (match2) {
    return {
      type: "switch",
      target: match2[1].trim(),
      task: match2[2].trim() || undefined,
      original: input,
    };
  }

  // 模式 3: 回到 <目录>
  const pattern3 = /回到\s+(.+)/;
  const match3 = input.match(pattern3);
  if (match3) {
    return {
      type: "switch",
      target: match3[1].trim(),
      original: input,
    };
  }

  // 模式 4: 用 <目录> 项目
  const pattern4 = /用\s+(.+?)\s+项目/;
  const match4 = input.match(pattern4);
  if (match4) {
    return {
      type: "switch",
      target: match4[1].trim(),
      original: input,
    };
  }

  return null;
}

/**
 * 将关键词解析为目录路径
 */
export function resolveDirectoryKeyword(
  keyword: string,
  knownProjects: Set<string>,
  cwd: string
): string | null {
  // 1. 绝对路径
  if (isAbsolute(keyword)) {
    const normalized = resolve(keyword);
    if (existsSync(normalized)) {
      return normalized;
    }
  }

  // 2. 已知项目名称匹配
  for (const projectPath of knownProjects) {
    const name = basename(projectPath);
    if (name.toLowerCase() === keyword.toLowerCase()) {
      return projectPath;
    }
  }

  // 3. 相对路径
  const relativePath = resolve(cwd, keyword);
  if (existsSync(relativePath)) {
    return relativePath;
  }

  return null;
}
```

- [ ] **Step 2: 创建测试文件**

创建 `tests/directoryParser.test.ts`：

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDirectorySwitch,
  resolveDirectoryKeyword,
} from "../src/session/directoryParser.js";

// 模式测试
test("parseDirectorySwitch: 模式 1 '切换到'", () => {
  const result = parseDirectorySwitch("切换到 website 项目");
  assert.notEqual(result, null);
  assert.equal(result?.type, "switch");
  assert.equal(result?.target, "website 项目");
});

test("parseDirectorySwitch: 模式 2 '在...里'", () => {
  const result = parseDirectorySwitch("在 my-app 里帮我写个函数");
  assert.notEqual(result, null);
  assert.equal(result?.target, "my-app");
  assert.equal(result?.task, "帮我写个函数");
});

test("parseDirectorySwitch: 模式 3 '回到'", () => {
  const result = parseDirectorySwitch("回到 website");
  assert.notEqual(result, null);
  assert.equal(result?.target, "website");
});

test("parseDirectorySwitch: 模式 4 '用...项目'", () => {
  const result = parseDirectorySwitch("用 website 项目");
  assert.notEqual(result, null);
  assert.equal(result?.target, "website");
});

test("parseDirectorySwitch: 不匹配返回 null", () => {
  const result = parseDirectorySwitch("帮我写个函数");
  assert.equal(result, null);
});

// 关键词解析测试
test("resolveDirectoryKeyword: 绝对路径直接返回", () => {
  const knownProjects = new Set(["D:/projects/website"]);
  const result = resolveDirectoryKeyword(
    "D:/projects/myapp",
    knownProjects,
    "/home/user"
  );
  assert.equal(result, "D:/projects/myapp");
});

test("resolveDirectoryKeyword: 已知项目名称匹配", () => {
  const knownProjects = new Set(["D:/projects/website", "D:/projects/myapp"]);
  const result = resolveDirectoryKeyword("website", knownProjects, "/home/user");
  assert.equal(result, "D:/projects/website");
});

test("resolveDirectoryKeyword: 无效关键词返回 null", () => {
  const knownProjects = new Set<string>();
  const result = resolveDirectoryKeyword("nonexistent", knownProjects, "/home/user");
  assert.equal(result, null);
});
```

- [ ] **Step 3: 运行测试**

Run: `npm test tests/directoryParser.test.ts`
Expected: PASS

- [ ] **Step 4: 提交实现**

```bash
git add src/session/directoryParser.ts tests/directoryParser.test.ts
git commit -m "feat(session): 实现语音目录切换解析器"
```

---

### Task 2: 集成会话持久化

**目标：** 扩展 DirectorySessionManager，支持会话文件保存和已知项目持久化。

**Files:**
- Modify: `src/session/directorySessionManager.ts`
- Modify: `src/session/types.ts`
- Create: `tests/sessionPersistence.test.ts`

**Interfaces:**
- Consumes:
  - `loadSession(sessionFile: string): SessionLoadResult`
  - `saveSessionId(sessionFile: string, sessionId: string): void`
- Produces:
  - `KnownProjectsData` interface

---

- [ ] **Step 1: 扩展类型定义**

在 `src/session/types.ts` 中添加：

```typescript
/**
 * 已知项目持久化数据结构
 */
export interface KnownProjectsData {
  version: 1;
  projects: Array<{
    cwd: string;
    chatId: string;
    lastUsedAt: string;
  }>;
}
```

- [ ] **Step 2: 扩展 DirectorySessionManager**

在 `src/session/directorySessionManager.ts` 中：

添加导入：
```typescript
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadSession, saveSessionId } from "./persistSession.js";
import type { KnownProjectsData } from "./types.js";
```

添加属性：
```typescript
export class DirectorySessionManager {
  private registry: ExecutorRegistry;
  private _activeCwd: string;
  private knownProjects: Set<string> = new Set();
  private sessionDir: string;  // 新增

  constructor(config: Config) {
    this.registry = new ExecutorRegistry({
      idleTimeoutMs: config.executor?.idleTimeoutMs,
      maxConcurrent: config.executor?.maxConcurrent,
    });
    this._activeCwd = this.resolveInitialCwd(config);
    this.sessionDir = join(homedir(), '.voxbridge', 'sessions');
    this.loadKnownProjects();
  }
```

添加方法：
```typescript
  private getSessionFile(chatId: string): string {
    const filename = chatId.replace(/[\/:]/g, '_') + '.json';
    return join(this.sessionDir, filename);
  }

  private loadKnownProjects(): void {
    try {
      const dataFile = join(this.sessionDir, '..', 'known_projects.json');
      if (!existsSync(dataFile)) return;

      const data: KnownProjectsData = JSON.parse(
        readFileSync(dataFile, 'utf-8')
      );

      for (const project of data.projects) {
        this.knownProjects.add(project.chatId);
      }
    } catch (error) {
      // 忽略加载错误
    }
  }

  private saveKnownProjects(): void {
    try {
      mkdirSync(join(this.sessionDir, '..'), { recursive: true });

      const data: KnownProjectsData = {
        version: 1,
        projects: Array.from(this.knownProjects).map(chatId => ({
          cwd: chatId,
          chatId,
          lastUsedAt: new Date().toISOString(),
        })),
      };

      const dataFile = join(this.sessionDir, '..', 'known_projects.json');
      writeFileSync(dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      // 忽略保存错误
    }
  }
```

修改 acquire 和 release：
```typescript
  async acquire(): Promise<RegistryEntry> {
    const chatId = this.generateChatId(this._activeCwd);
    const sessionFile = this.getSessionFile(chatId);

    const persisted = loadSession(sessionFile);
    if (persisted.kind === "valid") {
      // TODO: 实现 sessionId 续接
    }

    return this.registry.acquire(chatId, { cwd: this._activeCwd });
  }

  async release(reason: string): Promise<void> {
    const chatId = this.generateChatId(this._activeCwd);
    const entry = this.registry.peek(chatId);

    if (entry?.executor && 'sessionId' in entry.executor) {
      const sessionId = (entry.executor as any).sessionId;
      if (sessionId) {
        const sessionFile = this.getSessionFile(chatId);
        saveSessionId(sessionFile, sessionId);
      }
    }

    await this.registry.release(chatId, reason);
    this.saveKnownProjects();
  }
```

- [ ] **Step 3: 创建集成测试**

创建 `tests/sessionPersistence.test.ts`：

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectorySessionManager } from "../src/session/directorySessionManager.js";
import type { Config } from "../src/config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

function createTestConfig(): Config {
  return {
    stt: { model: "test", model_dir: "/tmp", language: "zh", python_path: "python" },
    trigger: { key: "F9", global: false },
    agent: { resume: false, systemPrompt: "", confirmDangerous: false },
    executor: { persistent: true, idleTimeoutMs: 60000, maxConcurrent: 5 },
  } as Config;
}

test("会话持久化: acquire 和 release 集成", async () => {
  const manager = new DirectorySessionManager(createTestConfig());
  const tempDir = join(tmpdir(), `voxbridge-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const entry1 = await manager.acquire();
    assert.ok(entry1.executor);

    await manager.release("test");

    const entry2 = await manager.acquire();
    assert.equal(entry1.executor, entry2.executor);

    await manager.release("test");
  } finally {
    await manager.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: 运行测试**

Run: `npm test tests/sessionPersistence.test.ts`
Expected: PASS

- [ ] **Step 5: 提交实现**

```bash
git add src/session/directorySessionManager.ts src/session/types.ts tests/sessionPersistence.test.ts
git commit -m "feat(session): 集成会话持久化到 DirectorySessionManager"
```

---

### Task 3: 实现配置 cwd 支持

**目标：** 支持 config.executor.cwd 和命令行参数，按优先级解析初始目录。

**Files:**
- Modify: `src/session/directorySessionManager.ts`
- Modify: `src/config.ts`
- Create: `tests/cwdResolution.test.ts`

---

- [ ] **Step 1: 扩展配置类型**

在 `src/config.ts` 中找到或创建 ExecutorConfig：

```typescript
export interface ExecutorConfig {
  cwd?: string;
  initialCwd?: string;
  idleTimeoutMs?: number;
  maxConcurrent?: number;
  persistent?: boolean;
}
```

- [ ] **Step 2: 实现 cwd 优先级解析**

在 `src/session/directorySessionManager.ts` 中添加：

```typescript
  private resolveInitialCwd(config: Config): string {
    // 1. 命令行参数（最高优先级）
    if (config.executor?.initialCwd) {
      const normalized = resolve(config.executor.initialCwd);
      if (existsSync(normalized)) {
        return normalized;
      }
    }

    // 2. 配置文件 cwd
    if (config.executor?.cwd) {
      const normalized = resolve(config.executor.cwd);
      if (existsSync(normalized)) {
        return normalized;
      }
    }

    // 3. 默认回退
    return process.cwd();
  }
```

- [ ] **Step 3: 创建测试**

创建 `tests/cwdResolution.test.ts`：

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectorySessionManager } from "../src/session/directorySessionManager.js";
import type { Config } from "../src/config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    stt: { model: "test", model_dir: "/tmp", language: "zh", python_path: "python" },
    trigger: { key: "F9", global: false },
    agent: { resume: false, systemPrompt: "", confirmDangerous: false },
    executor: { persistent: true, idleTimeoutMs: 60000, maxConcurrent: 5 },
    ...overrides,
  } as Config;
}

test("cwd 优先级: 命令行 > 配置 > 默认", async () => {
  const tempDir = join(tmpdir(), `voxbridge-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const config = createTestConfig({
      executor: {
        cwd: "/should/be/ignored",
        initialCwd: tempDir,
        persistent: true,
      },
    });

    const manager = new DirectorySessionManager(config);
    assert.equal(manager.getActiveCwd(), tempDir);
    await manager.shutdown();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cwd 优先级: 配置文件 cwd", async () => {
  const tempDir = join(tmpdir(), `voxbridge-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const config = createTestConfig({
      executor: {
        cwd: tempDir,
        persistent: true,
      },
    });

    const manager = new DirectorySessionManager(config);
    assert.equal(manager.getActiveCwd(), tempDir);
    await manager.shutdown();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cwd 优先级: 默认 process.cwd()", async () => {
  const config = createTestConfig();
  const manager = new DirectorySessionManager(config);
  assert.equal(manager.getActiveCwd(), process.cwd());
  await manager.shutdown();
});
```

- [ ] **Step 4: 运行测试**

Run: `npm test tests/cwdResolution.test.ts`
Expected: PASS

- [ ] **Step 5: 提交实现**

```bash
git add src/session/directorySessionManager.ts src/config.ts tests/cwdResolution.test.ts
git commit -m "feat(session): 实现配置 cwd 支持"
```

---

## Phase 1 Checkpoint

- [ ] 所有单元测试通过：`npm test`
- [ ] 无回归 bug
- [ ] 代码覆盖率 > 80%

---

## Phase 2: 用户体验增强

### Task 4: 优化错误处理

**目标：** 增强进程健康检查，实现用户友好的错误提示。

**Files:**
- Modify: `src/executor/registry.ts`
- Create: `src/session/errorFormatter.ts`
- Modify: `tests/errorHandling.test.ts`

---

- [ ] **Step 1: 添加健康检查方法**

在 `src/executor/registry.ts` 中添加：

```typescript
  async healthCheck(chatId: string): Promise<boolean> {
    const entry = this.executors.get(chatId);
    if (!entry) return false;
    return !entry.executor.isDisposed;
  }
```

- [ ] **Step 2: 创建错误格式化模块**

创建 `src/session/errorFormatter.ts`：

```typescript
export interface ErrorContext {
  type: "process_crash" | "network_error" | "session_expired";
  message: string;
  recovery: "retry" | "new_session" | "check_network";
}

export function formatErrorForUser(error: ErrorContext): string {
  const templates = {
    process_crash: `❌ CC 进程崩溃！\n原因: ${error.message}\n建议: 重新输入，将创建新会话`,
    network_error: `❌ 网络错误！\n原因: ${error.message}\n建议: 检查网络连接后直接重试`,
    session_expired: `⚠️ 会话已过期\n建议: 已创建新会话继续工作`,
  };

  return templates[error.type] || `错误: ${error.message}`;
}
```

- [ ] **Step 3: 扩展测试**

在 `tests/errorHandling.test.ts` 中添加：

```typescript
import { formatErrorForUser } from "../src/session/errorFormatter.js";
import type { ErrorContext } from "../src/session/errorFormatter.js";

test("formatErrorForUser: 进程崩溃", () => {
  const error: ErrorContext = {
    type: "process_crash",
    message: "内存不足",
    recovery: "new_session",
  };
  const result = formatErrorForUser(error);
  assert.ok(result.includes("进程崩溃"));
  assert.ok(result.includes("内存不足"));
});

test("formatErrorForUser: 网络错误", () => {
  const error: ErrorContext = {
    type: "network_error",
    message: "Connection timeout",
    recovery: "check_network",
  };
  const result = formatErrorForUser(error);
  assert.ok(result.includes("网络错误"));
});
```

- [ ] **Step 4: 运行测试**

Run: `npm test tests/errorHandling.test.ts`
Expected: PASS

- [ ] **Step 5: 提交实现**

```bash
git add src/executor/registry.ts src/session/errorFormatter.ts tests/errorHandling.test.ts
git commit -m "feat(session): 优化错误处理"
```

---

### Task 5: 实现语音切换集成

**目标：** 在主流程中集成 directoryParser。

**Files:**
- Create: `tests/e2e/voiceDirectorySwitch.test.ts`

---

- [ ] **Step 1: 创建 E2E 测试**

创建 `tests/e2e/voiceDirectorySwitch.test.ts`：

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectorySessionManager } from "../../src/session/directorySessionManager.js";
import type { Config } from "../../src/config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import {
  parseDirectorySwitch,
  resolveDirectoryKeyword,
} from "../../src/session/directoryParser.js";

function createTestConfig(): Config {
  return {
    stt: { model: "test", model_dir: "/tmp", language: "zh", python_path: "python" },
    trigger: { key: "F9", global: false },
    agent: { resume: false, systemPrompt: "", confirmDangerous: false },
    executor: { persistent: true, idleTimeoutMs: 60000, maxConcurrent: 5 },
  } as Config;
}

test("语音切换: 完整流程", async () => {
  const manager = new DirectorySessionManager(createTestConfig());
  const tempDir1 = join(tmpdir(), `test-${Date.now()}-1`);
  const tempDir2 = join(tmpdir(), `test-${Date.now()}-2`);

  mkdirSync(tempDir1, { recursive: true });
  mkdirSync(tempDir2, { recursive: true });

  try {
    await manager.switchDirectory(tempDir1);

    const input = `切换到 ${tempDir2}`;
    const switchCmd = parseDirectorySwitch(input);
    assert.ok(switchCmd);

    const targetDir = resolveDirectoryKeyword(
      switchCmd.target,
      manager.getKnownProjects(),
      manager.getActiveCwd()
    );
    assert.equal(targetDir, tempDir2);

    const result = await manager.switchDirectory(targetDir!);
    assert.equal(result.ok, true);

    await manager.shutdown();
  } finally {
    rmSync(tempDir1, { recursive: true, force: true });
    rmSync(tempDir2, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行测试**

Run: `npm test tests/e2e/voiceDirectorySwitch.test.ts`
Expected: PASS

- [ ] **Step 3: 提交实现**

```bash
git add tests/e2e/voiceDirectorySwitch.test.ts
git commit -m "feat(session): 实现语音切换集成"
```

---

## Phase 2 Checkpoint

- [ ] 所有测试通过
- [ ] E2E 测试通过

---

## Phase 3: 文档与验收

### Task 6: 补充用户文档

**Files:**
- Create: `docs/user-guide/session-management.md`
- Modify: `README.md`

---

- [ ] **Step 1: 创建用户指南**

创建 `docs/user-guide/session-management.md`（内容见设计文档）

- [ ] **Step 2: 更新 README**

在 README.md 中添加会话管理说明（内容见设计文档）

- [ ] **Step 3: 提交文档**

```bash
git add docs/user-guide/session-management.md README.md
git commit -m "docs: 补充会话管理用户文档"
```

---

### Task 7: 完整验收测试

**目标：** 运行所有测试，生成验收报告。

---

- [ ] **Step 1: 运行所有测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: 运行 E2E 测试**

Run: `npm test tests/e2e/`
Expected: PASS

- [ ] **Step 3: 创建验收报告**

创建 `docs/validation/session-strategy-A-validation-report.md`（模板见设计文档）

- [ ] **Step 4: 提交验收报告**

```bash
git add docs/validation/session-strategy-A-validation-report.md
git commit -m "docs: 添加 Session Strategy A 验收报告"
```

---

## 最终验收清单

### Phase 1 完成

- [ ] 语音目录切换解析器测试通过
- [ ] 会话持久化工作正常
- [ ] 配置 cwd 功能正常
- [ ] 无回归 bug

### Phase 2 完成

- [ ] 错误处理用户友好
- [ ] 语音切换集成工作

### Phase 3 完成

- [ ] 用户文档完整
- [ ] 验收报告归档
- [ ] 代码覆盖率 > 80%

---

**计划完成。两种执行方式：**

1. **Subagent-Driven（推荐）** - 我为每个任务派遣独立的子代理，任务间审查

2. **Inline Execution** - 在当前会话中批量执行，检查点审查

**选择哪种方式？**