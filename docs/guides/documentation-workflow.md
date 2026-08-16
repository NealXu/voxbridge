# 文档工作流指南

## 概述

本文档描述了从实施计划到正式文档的完整工作流。当 `docs/superpowers/plans/` 中的实施计划完成编码后，需要将计划内容提炼到正式文档中，然后归档计划文件。

---

## 目录结构

```
docs/
├── superpowers/          # 实施计划（本地规划，已 gitignore）
│   └── plans/
│       └── 2026-08-16-asr-engine-upgrade.md
├── architecture/         # 架构文档（正式）
├── features/             # 功能文档（正式）
├── guides/               # 使用指南（正式）
└── archive/              # 已归档的实施计划（已 gitignore）
    └── 2026-08-16-asr-engine-upgrade.md
```

---

## 工作流步骤

### 1. 实施计划完成后

当 `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` 中的计划已完成编码和测试：

```bash
# 确认代码已合并到 master
git log --oneline -5

# 确认测试通过
npm test
.venv/Scripts/python.exe -m pytest tests/python/
```

### 2. 提炼文档内容

从实施计划中提取关键信息，创建或更新以下文档：

#### 架构文档 (`docs/architecture/`)

- **适用场景**：涉及系统架构变更、新增模块、组件交互
- **内容**：
  - 系统架构图（组件关系、数据流）
  - 设计决策和权衡
  - 模块职责和接口定义
  - 扩展点说明

**示例**：
- `stt-worker-architecture.md` - STT Worker 插件化架构
- `engine-factory-pattern.md` - 引擎工厂模式设计

#### 功能文档 (`docs/features/`)

- **适用场景**：新增功能、功能增强、用户可见特性
- **内容**：
  - 功能描述和使用场景
  - 配置选项和参数说明
  - 使用示例
  - 限制和已知问题

**示例**：
- `multi-engine-support.md` - 多引擎支持（SenseVoice、Paraformer、Whisper）
- `exe-worker-deployment.md` - EXE Worker 部署指南

#### 使用指南 (`docs/guides/`)

- **适用场景**：操作指南、配置教程、最佳实践
- **内容**：
  - 步骤式操作说明
  - 配置示例
  - 故障排查
  - 常见问题

**示例**：
- `logging.md` - 日志系统使用指南
- `vad-tuning.md` - VAD 参数调优指南
- `e2e-verification.md` - E2E 验收测试指南

### 3. 归档实施计划

将已完成的实施计划移动到归档目录：

```powershell
# 移动到归档目录
Move-Item `
  "docs/superpowers/plans/2026-08-16-asr-engine-upgrade.md" `
  "docs/archive/2026-08-16-asr-engine-upgrade.md"
```

**归档命名规范**：`YYYY-MM-DD-<feature-name>.md`

### 4. 提交文档更新

```bash
git add docs/architecture/ docs/features/ docs/guides/
git commit -m "docs: 提炼实施计划到正式文档

- 新增/更新架构文档: <文档名>
- 新增/更新功能文档: <文档名>
- 归档实施计划: YYYY-MM-DD-<feature-name>.md"
```

---

## 文档提炼模板

### 从实施计划提取的内容

| 实施计划章节 | 目标文档 | 提炼内容 |
|-------------|---------|---------|
| **Context** | features/ | 功能背景、解决的问题 |
| **架构设计** | architecture/ | 系统架构图、组件关系、数据流 |
| **实施计划** | features/ + guides/ | 功能说明、配置选项、使用步骤 |
| **验证计划** | guides/ | 测试步骤、验收标准 |
| **后续扩展** | architecture/ | 扩展点、未来规划 |

### 文档结构建议

#### 架构文档模板

```markdown
# <模块名称> 架构

## 概述
- 模块职责
- 解决的问题

## 架构图
- 组件关系图（ASCII 或 Mermaid）
- 数据流说明

## 核心组件
- 组件 A：职责、接口
- 组件 B：职责、接口

## 设计决策
- 为什么选择方案 X 而非方案 Y
- 权衡和取舍

## 扩展点
- 如何添加新组件
- 配置选项
```

#### 功能文档模板

```markdown
# <功能名称>

## 概述
- 功能描述
- 使用场景

## 配置
```json
{
  "option1": "value1",
  "option2": "value2"
}
```

## 使用示例
- 基本用法
- 高级配置

## 限制和已知问题
- 限制 1
- 限制 2

## 相关文档
- [架构文档](../architecture/xxx.md)
- [使用指南](../guides/xxx.md)
```

#### 使用指南模板

```markdown
# <指南名称>

## 前置条件
- 依赖项
- 环境要求

## 步骤 1: <操作名称>
- 详细说明
- 代码/命令示例
- 预期结果

## 步骤 2: <操作名称>
...

## 故障排查
- 问题 1：解决方案
- 问题 2：解决方案

## 常见问题
- Q: 问题？
  A: 答案
```

---

## 实际案例：ASR Engine Upgrade

### 实施计划

`docs/superpowers/plans/2026-08-16-asr-engine-upgrade.md`

### 提炼的文档

#### 1. 架构文档

**新增**: `docs/architecture/stt-worker-architecture.md`

内容：
- STT Worker 插件化架构设计
- WorkerFactory 路由层
- Worker 类型（python/exe/cloud/native）
- 引擎工厂模式（EngineFactory）
- 数据流：Node.js → Worker → Engine

#### 2. 功能文档

**新增**: `docs/features/multi-engine-support.md`

内容：
- 多引擎支持概述（SenseVoice、Paraformer、Whisper）
- 引擎选择配置
- ONNX 引擎优势
- 引擎切换和回退机制

**新增**: `docs/features/exe-worker-deployment.md`

内容：
- EXE Worker 部署方式
- PyInstaller 打包配置
- 模型文件管理
- 独立运行模式

#### 3. 使用指南

**更新**: `docs/guides/e2e-verification.md`

内容：
- E2E 验收测试流程
- 自动化测试脚本
- 手动测试场景
- 部署验证清单

#### 4. 归档

**移动**: `docs/superpowers/plans/2026-08-16-asr-engine-upgrade.md` → `docs/archive/2026-08-16-asr-engine-upgrade.md`

---

## 最佳实践

### 1. 及时归档

- 代码合并到 master 后**立即**提炼文档
- 不要积累多个未归档的实施计划
- 归档前先 review 计划内容，确保提炼完整

### 2. 文档质量

- **架构文档**：重点在"为什么"，而非"怎么做"
- **功能文档**：重点在"怎么用"，提供完整配置示例
- **使用指南**：重点在"步骤"，确保可复现

### 3. 交叉引用

- 架构文档引用功能文档（"详见 `<feature-name>.md`"）
- 功能文档引用使用指南（"操作指南见 `<guide-name>.md`"）
- 使用指南引用架构文档（"设计原理见 `<architecture-name>.md`"）

### 4. 版本控制

- 正式文档（architecture/features/guides）**必须**纳入 git 版本控制
- 实施计划和归档目录**不纳入**版本控制（已 gitignore）
- 文档变更随代码一起提交和 review

---

## 自动化建议

未来可以考虑自动化：

1. **实施计划模板**：在 `docs/superpowers/plans/` 提供标准模板
2. **归档脚本**：`scripts/archive-plan.ps1` 自动移动文件
3. **文档检查**：CI 检查新增功能是否有对应文档
4. **交叉引用验证**：检查文档间的引用链接是否有效

---

## 相关资源

- [日志系统指南](./logging.md)
- [E2E 验收指南](./e2e-verification.md)
- [VAD 调优指南](./vad-tuning.md)
