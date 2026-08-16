---
name: doc-archive
description: 实施计划完成后的文档提炼与归档。当 docs/superpowers/plans/ 中的实施计划完成编码和测试后，使用此技能将计划内容提炼到正式文档（architecture/features/guides），然后归档计划文件。触发场景：用户说"归档文档"、"提炼实施计划"、"计划完成了需要整理文档"、"把计划归档"、"docs archive"，或者当实施计划的代码已合并到 master 且测试全部通过时。即使用户没有明确说"归档"，只要提到某个实施计划做完了、代码合并了、需要整理文档，都应该使用此技能。
---

# 文档提炼与归档

当 `docs/superpowers/plans/` 中的实施计划完成编码、测试并合并到 master 后，需要将计划内容提炼到正式文档，然后归档计划文件。

## 为什么要做这件事

实施计划是"过程中的文档"，记录了设计决策、架构变更和功能细节。但它们的格式是面向实施的（包含 TODO、时间线、代码片段等），不适合作为长期参考。正式文档（architecture/features/guides）才是用户和开发者日常查阅的资料。如果不及时提炼，这些知识就会随着计划归档而被埋没。

## 工作流程

### Step 1: 确认前置条件

在开始提炼之前，确认实施计划确实已完成：

```bash
# 确认代码已合并到 master
git log --oneline master | head -5

# 确认测试通过
npm test
.venv/Scripts/python.exe -m pytest tests/python/ -q
```

如果测试失败或代码未合并，停下来，先解决这些问题。

### Step 2: 阅读实施计划

完整阅读 `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`，理解：

- **Context**: 解决了什么问题？为什么要做这个功能？
- **架构设计**: 系统架构发生了什么变化？新增了哪些组件？
- **实施细节**: 具体的功能点、配置选项、使用方式
- **验证计划**: 如何测试和验收
- **后续扩展**: 未来可能的演进方向

### Step 3: 判断需要提炼哪些文档

根据实施计划的内容，判断需要新增或更新哪些文档：

| 计划内容 | 目标文档类型 | 判断标准 |
|---------|------------|---------|
| 系统架构变更、新增模块、组件交互 | `docs/architecture/` | 涉及"为什么这样设计"、组件关系图、数据流 |
| 新增功能、功能增强、用户可见特性 | `docs/features/` | 涉及"怎么用"、配置选项、使用场景 |
| 操作指南、配置教程、最佳实践 | `docs/guides/` | 涉及"步骤"、操作说明、故障排查 |

一个实施计划可能同时产生多种类型的文档。例如，ASR Engine Upgrade 计划同时产生了：
- `docs/architecture/stt-worker-architecture.md`（架构设计）
- `docs/features/multi-engine-support.md`（功能说明）
- `docs/features/exe-worker-deployment.md`（部署指南）
- 更新 `docs/guides/e2e-verification.md`（验收测试更新）

### Step 4: 提炼文档

对于每种需要新增或更新的文档，按照以下模板提炼内容。详细模板参见 `docs/guides/documentation-workflow.md`。

#### 架构文档提炼要点

从实施计划中提取：
- 系统架构图（ASCII 或 Mermaid）
- 核心组件的职责和接口
- 设计决策和权衡（为什么选择方案 A 而非方案 B）
- 扩展点说明

重点在"为什么"，而非"怎么做"。

#### 功能文档提炼要点

从实施计划中提取：
- 功能描述和使用场景
- 配置选项和参数说明（附 JSON 示例）
- 使用示例（基本用法 + 高级配置）
- 限制和已知问题

重点在"怎么用"，提供完整的配置示例。

#### 使用指南提炼要点

从实施计划中提取：
- 步骤式操作说明
- 命令和代码示例
- 故障排查和常见问题

重点在"步骤"，确保可复现。

### Step 5: 归档实施计划

将已完成的实施计划移动到归档目录：

```powershell
Move-Item `
  "docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md" `
  "docs/archive/YYYY-MM-DD-<feature-name>.md"
```

`docs/superpowers/` 和 `docs/archive/` 都已加入 `.gitignore`，不会被纳入版本控制。

### Step 6: 提交文档更新

```bash
git add docs/architecture/ docs/features/ docs/guides/
git commit -m "docs: 提炼实施计划到正式文档

- 新增/更新架构文档: <文档名>
- 新增/更新功能文档: <文档名>
- 更新使用指南: <文档名>
- 归档实施计划: YYYY-MM-DD-<feature-name>.md"
```

注意：只提交正式文档的变更，不要提交 docs/superpowers/ 或 docs/archive/ 的变更（它们被 gitignore 忽略）。

## 提炼内容的映射关系

| 实施计划章节 | 目标文档 | 提炼内容 |
|-------------|---------|---------|
| **Context** | features/ | 功能背景、解决的问题、使用场景 |
| **架构设计** | architecture/ | 系统架构图、组件关系、数据流、设计决策 |
| **实施计划** | features/ + guides/ | 功能说明、配置选项、使用步骤 |
| **验证计划** | guides/ | 测试步骤、验收标准、故障排查 |
| **后续扩展** | architecture/ | 扩展点、未来规划 |

## 质量检查清单

提炼完成后，检查：

- [ ] 架构文档回答了"为什么这样设计"
- [ ] 功能文档包含完整的配置示例
- [ ] 使用指南的步骤可复现
- [ ] 文档之间有交叉引用（architecture ↔ features ↔ guides）
- [ ] 实施计划已移动到 docs/archive/
- [ ] 只提交了正式文档，未提交归档文件
- [ ] 测试仍然通过

## 实际案例

参考 ASR Engine Upgrade 的归档过程：

**实施计划**: `docs/superpowers/plans/2026-08-16-asr-engine-upgrade.md`

**提炼的文档**:
1. `docs/architecture/stt-worker-architecture.md` — STT Worker 插件化架构
2. `docs/features/multi-engine-support.md` — 多引擎支持
3. `docs/features/exe-worker-deployment.md` — EXE Worker 部署
4. 更新 `docs/guides/e2e-verification.md` — E2E 验收测试

**归档**: 计划文件移动到 `docs/archive/2026-08-16-asr-engine-upgrade.md`

## 相关资源

- 完整的文档模板和最佳实践: `docs/guides/documentation-workflow.md`
- .gitignore 配置: docs/superpowers/ 和 docs/archive/ 已忽略
