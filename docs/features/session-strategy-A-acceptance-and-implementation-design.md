# Session Strategy A: 验收场景与实施计划

**文档状态：** 设计完成
**创建日期：** 2026-08-16
**设计文档参考：** `docs/archive/2026-08-16-session-strategies/session-strategy-A-directory-driven.md`
**实现状态：** 待开发（当前完成度 70%）

---

## 执行摘要

本文档基于 `session-strategy-A-directory-driven.md` 设计文档与当前实现的差距分析，制定完整的验收测试套件和分阶段实施计划。目标是补全缺失功能（语音目录切换、会话持久化集成、配置支持），将实现完成度从 70% 提升到 100%。

---

## 1. 验收场景级用例设计

### 1.1 场景分类框架

```
验收层级：
├─ 单元测试（Unit）        - 单个函数/类的行为验证
├─ 集成测试（Integration） - 模块间协作验证
├─ 端到端测试（E2E）       - 完整用户流程验证（需 CLAUDE_INTEGRATION=1）
└─ 用户验收测试（UAT）     - 手动测试验收
```

### 1.2 验收用例清单

#### UC-01: 基础会话生命周期

**设计文档参考：** 第142-187行

| 用例ID | 场景 | 验收标准 | 测试层级 |
|--------|------|---------|---------|
| UC-01-01 | 首次启动，无历史会话 | 系统使用 `process.cwd()` 作为默认目录，CC 实例等待首次输入 | E2E |
| UC-01-02 | 首次输入触发进程创建 | 第一个语音输入时创建 CC 进程，chatId = 规范化的 cwd | E2E |
| UC-01-03 | 第二次输入复用进程 | 同一目录的后续输入复用已有进程，无创建开销 | E2E |
| UC-01-04 | 进程租约计数正确 | acquire() 后 leases=1，release() 后 leases=0 | 单元 |
| UC-01-05 | idle 超时自动回收 | leases=0 后等待 `idleTimeoutMs`，进程自动销毁 | 单元+集成 |

**验收步骤示例（UC-01-02）：**
```gherkin
Given 用户启动 VoxBridge，当前目录 D:\Projects\my-app
When 用户第一次按 F9 说 "添加一个登录页面"
Then 系统创建新的 CC 进程
And chatId = "d:/projects/my-app"
And 进程状态为 idle（等待下次输入）
And 用户收到回复 "已创建登录页面"
```

---

#### UC-02: 目录切换流程

**设计文档参考：** 第102-133行

| 用例ID | 场景 | 验收标准 | 测试层级 |
|--------|------|---------|---------|
| UC-02-01 | 切换到已存在的目录 | 旧进程保持运行，新进程创建，activeCwd 更新 | 集成 |
| UC-02-02 | 切换到不存在的目录 | 返回错误 `{ ok: false, error: "directory_not_found" }`，保持当前目录 | 单元 |
| UC-02-03 | 切回已存在的目录 | 瞬间完成，复用之前的进程，会话上下文保持 | E2E |
| UC-02-04 | 切换时已知项目列表更新 | `isKnownProject(newDir)` 返回 true | 单元 |
| UC-02-05 | chatId 规范化一致性 | `D:\Projects\MyApp` 和 `D:/projects/myapp` 生成相同 chatId | 单元 |

**验收步骤示例（UC-02-03）：**
```gherkin
Given 用户在 D:\Projects\my-app（已有 CC 进程）
When 用户切换到 D:\Projects\website（创建新进程）
And 用户执行任务 "更新首页标题"
And 用户切回 D:\Projects\my-app
Then 系统复用 my-app 的旧进程（PID 不变）
And 会话上下文保持（之前的登录页面对话仍在）
```

---

#### UC-03: 多项目并发管理

**设计文档参考：** 第230-267行

| 用例ID | 场景 | 验收标准 | 测试层级 |
|--------|------|---------|---------|
| UC-03-01 | 达到 maxConcurrent 限制 | 拒绝新的 acquire()，抛出错误 | 单元 |
| UC-03-02 | LRU 驱逐策略 | 达到上限时，销毁最久未使用的 idle 进程 | 单元 |
| UC-03-03 | 多终端并行隔离 | 不同终端的进程池完全隔离（每个 VoxBridge 独立） | E2E（手动） |
| UC-03-04 | 进程状态独立跟踪 | 每个 RegistryEntry 独立的 lastUsedAt 和 leases | 单元 |

---

#### UC-04: 会话持久化 ⚠️ 差距项

**设计文档参考：** 第343-391行

| 用例ID | 场景 | 验收标准 | 测试层级 |
|--------|------|---------|---------|
| UC-04-01 | 退出时保存 sessionId | 文件 `~/.voxbridge/sessions/<chatId>.json` 包含有效数据 | 集成 |
| UC-04-02 | 重启时检测历史会话 | 启动时读取 session 文件，验证 lastUsedAt 和 age | 集成 |
| UC-04-03 | 会话续接成功 | SDK 确认 sessionId 可用，恢复会话上下文 | E2E |
| UC-04-04 | 会话过期回退 | sessionId 过期时，创建新会话并提示用户 | E2E |
| UC-04-05 | 多目录独立持久化 | 每个目录有独立的 session 文件 | 集成 |

**验收步骤示例（UC-04-03）：**
```gherkin
Given 用户在 Day 1 使用 my-app 项目
And sessionId = "sess_abc123" 已保存
When 用户在 Day 2 启动 VoxBridge（17.5 小时后）
Then 系统检测到历史 session 文件
And SDK 确认 session 仍可用
And 用户输入 "继续上次的登录页面"
And 系统恢复 session，复用会话上下文
```

---

#### UC-05: 语音目录切换 ❌ 缺失功能

**设计文档参考：** 第488-549行

| 用例ID | 场景 | 验收标准 | 测试层级 |
|--------|------|---------|---------|
| UC-05-01 | 解析 "切换到 <目录>" | 正确提取目标目录路径 | 单元 |
| UC-05-02 | 解析 "在 <目录> 里..." | 从输入中提取目录，剩余作为任务 | 单元 |
| UC-05-03 | 关键词匹配已知项目 | "website" → `D:\Projects\website` | 单元 |
| UC-05-04 | 相对路径解析 | "../my-app" 相对于 cwd 解析 | 单元 |
| UC-05-05 | 无效目录错误提示 | 目录不存在时提示用户，保持当前目录 | 集成 |

---

#### UC-06: 错误处理

**设计文档参考：** 第270-340行

| 用例ID | 场景 | 验收标准 | 测试层级 |
|--------|------|---------|---------|
| UC-06-01 | CC 进程崩溃 | 检测到异常退出，清理 Registry 条目，提示用户 | 集成 |
| UC-06-02 | 进程崩溃后重试 | 用户重试时创建新进程，提示"会话上下文已丢失" | E2E |
| UC-06-03 | 网络错误重试 | 网络错误后，进程存活，用户可直接重试 | E2E |
| UC-06-04 | 网络错误 vs 进程崩溃区分 | 网络错误：进程存活；崩溃：进程退出 | 集成 |

---

#### UC-07: 配置驱动 ⚠️ 差距项

**设计文档参考：** 第76-98行、第555-566行

| 用例ID | 场景 | 验收标准 | 测试层级 |
|--------|------|---------|---------|
| UC-07-01 | 命令行 `--cwd` 参数 | 启动时使用指定目录作为默认目录 | 集成 |
| UC-07-02 | 配置文件 `executor.cwd` | 未指定 `--cwd` 时使用配置文件的 cwd | 单元 |
| UC-07-03 | 优先级正确 | `--cwd` > `config.cwd` > `process.cwd()` | 单元 |
| UC-07-04 | 无效配置目录回退 | 配置的目录不存在时回退到 `process.cwd()` | 单元 |

---

### 1.3 验收覆盖率矩阵

| 设计场景章节 | 验收用例数 | 已实现 | 差距项 | 缺失项 |
|-------------|-----------|--------|--------|--------|
| 基础使用流程（142-187） | 5 | ✅ 5 | - | - |
| 目录切换流程（102-133） | 5 | ✅ 4 | ⚠️ 1 | - |
| 多终端并行（230-267） | 4 | ✅ 3 | ⚠️ 1（文档） | - |
| 会话持久化（343-391） | 5 | ⚠️ 2 | ⚠️ 3 | - |
| 语音目录切换（488-549） | 5 | ❌ 0 | - | ❌ 5 |
| 错误处理（270-340） | 4 | ⚠️ 2 | ⚠️ 2 | - |
| 配置驱动（76-98, 555-566） | 4 | ⚠️ 1 | ⚠️ 3 | - |
| **总计** | **32** | **17** | **10** | **5** |

**当前验收覆盖率：** 53% (17/32)
**目标验收覆盖率：** 100% (32/32)

---

## 2. 详细功能实施计划

### 2.1 阶段划分原则

```
Phase 1: 核心功能补全（高优先级差距）     - 3-4 天
Phase 2: 用户体验增强（中优先级差距）     - 2-3 天
Phase 3: 文档与错误处理完善（低优先级差距） - 1-2 天
```

---

### 2.2 Phase 1: 核心功能补全

**目标：** 补全高优先级差距项，实现核心设计功能

#### 任务 1.1: 实现语音目录切换解析器

**优先级：** 🔴 高
**依赖：** 无
**设计文档参考：** 第488-549行
**验收用例：** UC-05-01 ~ UC-05-05

**实施步骤：**

1. **创建解析模块** `src/session/directoryParser.ts`
   ```typescript
   export interface DirectorySwitch {
     type: "switch";
     target: string;        // 目标目录
     task?: string;         // 剩余任务（"在 X 里做 Y"）
     original: string;      // 原始输入
   }

   export function parseDirectorySwitch(input: string): DirectorySwitch | null
   export function resolveDirectoryKeyword(
     keyword: string,
     knownProjects: Set<string>,
     cwd: string
   ): string | null
   ```

2. **实现解析规则（正则匹配）**
   - 模式 1: `切换到\s+(.+)` → "切换到 website 项目"
   - 模式 2: `在\s+(.+?)\s+里` → "在 my-app 里帮我..."
   - 模式 3: `回到\s+(.+)` → "回到 website"
   - 模式 4: `用\s+(.+?)\s+项目` → "用 website 项目"

3. **实现关键词解析**
   - 绝对路径检测：`isAbsolute(keyword) && existsSync(keyword)`
   - 已知项目名称匹配：`basename(project) === keyword`
   - 相对路径解析：`resolve(cwd, keyword)`

4. **编写单元测试** `tests/directoryParser.test.ts`
   - 测试每个解析模式的正向和反向用例
   - 测试路径规范化（Windows/Unix）
   - 测试错误场景（空输入、无效路径）

**交付物：**
- ✅ `src/session/directoryParser.ts` 实现
- ✅ `tests/directoryParser.test.ts` 测试覆盖率 > 90%
- ✅ UC-05 所有用例通过

---

#### 任务 1.2: 集成会话持久化

**优先级：** 🔴 高
**依赖：** 无（已有 `persistSession.ts` 基础）
**设计文档参考：** 第343-391行
**验收用例：** UC-04-01 ~ UC-04-05

**实施步骤：**

1. **扩展 DirectorySessionManager**
   ```typescript
   class DirectorySessionManager {
     private sessionDir: string;  // ~/.voxbridge/sessions/

     constructor(config: Config) {
       this.sessionDir = join(homedir(), '.voxbridge', 'sessions');
       this.loadKnownProjects(); // 加载已知项目列表
     }

     async acquire(): Promise<RegistryEntry> {
       const sessionFile = this.getSessionFile(chatId);
       const persisted = loadSession(sessionFile);

       if (persisted.kind === "valid") {
         // 尝试续接（需验证 sessionId 有效性）
       }
       // 现有逻辑...
     }

     async release(reason: string): Promise<void> {
       // 现有逻辑...
       saveSessionId(sessionFile, entry.executor.sessionId);
       this.saveKnownProjects(); // 持久化已知项目列表
     }

     private getSessionFile(chatId: string): string {
       // chatId: "d:/projects/myapp" → "d__projects_myapp.json"
       const filename = chatId.replace(/[\/:]/g, '_') + '.json';
       return join(this.sessionDir, filename);
     }

     private loadKnownProjects(): void { /* ... */ }
     private saveKnownProjects(): void { /* ... */ }
   }
   ```

2. **实现会话文件命名规则**
   ```typescript
   function chatIdToFilename(chatId: string): string {
     return chatId.replace(/[\/:]/g, '_') + '.json';
   }
   ```

3. **实现已知项目列表持久化**
   ```typescript
   // ~/.voxbridge/known_projects.json
   interface KnownProjectsData {
     version: 1;
     projects: Array<{
       cwd: string;
       chatId: string;
       lastUsedAt: string; // ISO 8601
     }>;
   }
   ```

4. **编写集成测试** `tests/sessionPersistence.test.ts`
   - 测试会话保存和加载
   - 测试多目录独立持久化
   - 测试过期会话回退
   - 测试已知项目列表更新

**交付物：**
- ✅ DirectorySessionManager 持久化集成
- ✅ `tests/sessionPersistence.test.ts` 测试覆盖率 > 85%
- ✅ UC-04 所有用例通过
- ✅ 会话文件示例归档

---

#### 任务 1.3: 实现配置 cwd 支持

**优先级：** 🔴 高
**依赖：** 无
**设计文档参考：** 第76-98行、第555-566行
**验收用例：** UC-07-01 ~ UC-07-04

**实施步骤：**

1. **修改 DirectorySessionManager 构造函数**
   ```typescript
   constructor(config: Config) {
     this._activeCwd = this.resolveInitialCwd(config);
   }

   private resolveInitialCwd(config: Config): string {
     // 优先级：命令行 > 配置文件 > process.cwd()

     // 1. 命令行参数（外层传入，最高优先级）
     if (config.executor?.initialCwd) {
       const normalized = resolve(config.executor.initialCwd);
       if (existsSync(normalized)) return normalized;
     }

     // 2. 配置文件
     if (config.executor?.cwd) {
       const normalized = resolve(config.executor.cwd);
       if (existsSync(normalized)) return normalized;
     }

     // 3. 默认回退
     return process.cwd();
   }
   ```

2. **扩展配置类型** `src/config.ts`
   ```typescript
   interface ExecutorConfig {
     cwd?: string;           // 默认目录（配置文件）
     initialCwd?: string;    // 命令行传入（优先级最高）
     idleTimeoutMs?: number;
     maxConcurrent?: number;
     persistent?: boolean;
   }
   ```

3. **编写单元测试** `tests/cwdResolution.test.ts`
   - 测试优先级顺序（命令行 > 配置 > 默认）
   - 测试无效目录回退
   - 测试相对路径解析

**交付物：**
- ✅ cwd 优先级逻辑实现
- ✅ `tests/cwdResolution.test.ts` 测试覆盖率 > 90%
- ✅ UC-07 所有用例通过

---

### 2.3 Phase 2: 用户体验增强

**目标：** 优化用户交互体验，提升错误处理质量

#### 任务 2.1: 优化错误处理

**优先级：** 🟡 中
**依赖：** Phase 1 完成
**设计文档参考：** 第270-340行
**验收用例：** UC-06-01 ~ UC-06-04

**实施步骤：**

1. **增强进程健康检查**
   ```typescript
   // ExecutorRegistry 添加健康检查方法
   class ExecutorRegistry {
     async healthCheck(chatId: string): Promise<boolean> {
       const entry = this.executors.get(chatId);
       if (!entry) return false;
       return !entry.executor.isDisposed;
     }
   }
   ```

2. **实现用户友好的错误提示**
   ```typescript
   interface ErrorContext {
     type: "process_crash" | "network_error" | "session_expired";
     message: string;
     recovery: "retry" | "new_session" | "check_network";
   }

   function formatErrorForUser(error: ErrorContext): string {
     const templates = {
       process_crash: `❌ CC 进程崩溃！\n原因: {message}\n建议: 重新输入，将创建新会话`,
       network_error: `❌ 网络错误！\n原因: {message}\n建议: 检查网络连接后直接重试`,
       session_expired: `⚠️ 会话已过期\n建议: 已创建新会话继续工作`,
     };
     return templates[error.type];
   }
   ```

3. **实现进程崩溃自动清理**
   ```typescript
   // PersistentClaudeExecutor 添加崩溃监听
   class PersistentClaudeExecutor {
     private setupCrashHandler(): void {
       this.query?.on('error', (error) => {
         this.emit('crash', { error, chatId: this.chatId });
       });
     }
   }
   ```

4. **编写集成测试** `tests/errorHandling.test.ts`
   - 模拟进程崩溃场景
   - 测试错误恢复流程
   - 测试用户提示正确性

**交付物：**
- ✅ 错误分类和格式化
- ✅ 进程崩溃自动清理
- ✅ `tests/errorHandling.test.ts` 测试覆盖率 > 80%
- ✅ UC-06 所有用例通过

---

#### 任务 2.2: 实现语音切换集成

**优先级：** 🟡 中
**依赖：** 任务 1.1 完成
**设计文档参考：** 第102-133行
**验收用例：** UC-02 集成场景

**实施步骤：**

1. **在上层集成 directoryParser**
   ```typescript
   // 用户输入处理流程
   async function handleUserInput(input: string) {
     const switchCmd = parseDirectorySwitch(input);

     if (switchCmd) {
       // 目录切换流程
       const targetDir = resolveDirectoryKeyword(
         switchCmd.target,
         sessionManager.getKnownProjects(),
         sessionManager.getActiveCwd()
       );

       if (targetDir) {
         const result = await sessionManager.switchDirectory(targetDir);
         if (result.ok && switchCmd.task) {
           // 切换成功后继续执行剩余任务
           await executeTask(switchCmd.task);
         } else if (!result.ok) {
           // 提示用户切换失败
           console.error(`切换失败: ${result.error}`);
         }
       } else {
         // 提示目录不存在
         console.error(`未找到目录: ${switchCmd.target}`);
       }
     } else {
       // 普通任务执行
       await executeTask(input);
     }
   }
   ```

2. **实现已知项目查询接口**
   ```typescript
   class DirectorySessionManager {
     getKnownProjects(): Set<string> {
       return new Set(this.knownProjects);
     }
   }
   ```

3. **编写 E2E 测试** `tests/e2e/voiceDirectorySwitch.test.ts`
   - 测试语音切换流程完整路径
   - 测试切换后执行任务
   - 测试错误提示

**交付物：**
- ✅ 语音切换集成到主流程
- ✅ `tests/e2e/voiceDirectorySwitch.test.ts`
- ✅ UC-02 集成场景通过
- ✅ 用户可通过语音切换目录

---

### 2.4 Phase 3: 文档与验收完善

**目标：** 完成用户文档和最终验收

#### 任务 3.1: 补充用户文档

**优先级：** 🟢 低
**依赖：** Phase 1-2 完成
**设计文档参考：** 第230-267行

**实施步骤：**

1. **创建用户指南** `docs/user-guide/session-management.md`
   - 多终端并行说明
   - 资源占用权衡
   - 最佳实践
   - 常见问题

2. **更新项目 README**
   - 添加会话管理功能说明
   - 添加配置示例
   - 添加使用场景

**交付物：**
- ✅ 用户指南文档
- ✅ README 更新
- ✅ 用户可理解多终端行为

---

#### 任务 3.2: 完整验收测试

**优先级：** 🟢 低
**依赖：** 所有功能完成

**实施步骤：**

1. **运行完整验收套件**
   ```bash
   # 单元测试
   npm test

   # 集成测试
   npm run test:integration

   # E2E 测试（需要 CLAUDE_INTEGRATION=1）
   CLAUDE_INTEGRATION=1 npm run test:e2e
   ```

2. **手动 UAT 验收**
   - 按照 UC-01 ~ UC-07 的验收步骤手动测试
   - 记录问题和改进点

3. **生成验收报告** `docs/validation/session-strategy-A-validation-report.md`
   - 通过/失败统计
   - 剩余问题清单
   - 建议改进项

**交付物：**
- ✅ 所有自动化测试通过
- ✅ UAT 验收完成
- ✅ 验收报告归档
- ✅ 代码覆盖率 > 80%

---

## 3. 实施时间线

### 3.1 详细日程

```
Week 1:
├─ Day 1-2: 任务 1.1 - 语音目录切换解析器
├─ Day 3-4: 任务 1.2 - 会话持久化集成
└─ Day 5:   任务 1.3 - 配置 cwd 支持

Week 2:
├─ Day 1-2: 任务 2.1 - 错误处理优化
├─ Day 3:   任务 2.2 - 语音切换集成
└─ Day 4-5: 任务 3.1 & 3.2 - 文档与验收

总计: 7-9 个工作日
```

### 3.2 关键里程碑

| 里程碑 | 日期 | 交付物 |
|--------|------|--------|
| Phase 1 完成 | Week 1 结束 | 核心功能补全，单元测试通过 |
| Phase 2 完成 | Week 2 中期 | 用户体验增强，集成测试通过 |
| 最终验收 | Week 2 结束 | 所有验收用例通过，文档完整 |

---

## 4. 验收检查点

### 4.1 Checkpoint 1: Phase 1 完成标准

- [ ] 语音目录切换解析器单元测试全部通过
- [ ] 会话持久化可保存和恢复
- [ ] 配置 cwd 功能工作正常
- [ ] 无回归 bug（现有测试仍通过）

### 4.2 Checkpoint 2: Phase 2 完成标准

- [ ] 错误处理用户友好
- [ ] 语音切换集成工作
- [ ] E2E 测试通过

### 4.3 Checkpoint 3: 最终验收标准

- [ ] 32 个验收用例全部通过
- [ ] 用户文档完整
- [ ] 验收报告归档
- [ ] 代码覆盖率 > 80%

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| SDK session 续接失败率高 | UC-04 验收困难 | 增加重试机制，完善错误提示 |
| 多终端测试环境搭建复杂 | UC-03-03 耗时 | 使用 Docker 容器隔离测试 |
| 语音解析准确率不足 | UC-05 验收困难 | 增加模式库，支持用户自定义 |

---

## 6. 附录

### 6.1 测试文件组织结构

```
tests/
├─ unit/
│  ├─ directoryParser.test.ts      (任务 1.1)
│  ├─ cwdResolution.test.ts        (任务 1.3)
│  └─ errorHandling.test.ts        (任务 2.1)
├─ integration/
│  ├─ sessionPersistence.test.ts   (任务 1.2)
│  └─ directorySwitch.test.ts      (任务 2.2)
├─ e2e/
│  ├─ voiceDirectorySwitch.test.ts (任务 2.2)
│  └─ persistentSession.test.ts    (已存在，扩展)
└─ validation/
   └─ acceptance-tests.md          (手动 UAT 清单)
```

### 6.2 配置文件示例

**config.json（示例）：**
```json
{
  "executor": {
    "cwd": "D:\\Projects\\my-app",
    "idleTimeoutMs": 1800000,
    "maxConcurrent": 5,
    "persistent": true
  }
}
```

**命令行用法：**
```bash
# 使用配置文件的 cwd
voxbridge

# 命令行指定（覆盖配置）
voxbridge --cwd D:\Projects\website

# 回退到 process.cwd()
voxbridge --cwd /nonexistent/path
```

---

**设计完成，待用户审核后进入实施阶段。**