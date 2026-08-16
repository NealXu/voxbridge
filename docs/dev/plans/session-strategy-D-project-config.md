# 方案 D：项目配置 (Project Config)

**用途：** 设计文档，作为开发参考  
**用户指令：** 将方案A-E均生成细化的md文档

## 概述

每个项目目录下有 `.voxbridge.json` 配置文件，实现项目级配置。

---

## 配置文件格式

```json
// D:\Projects\my-app\.voxbridge.json
{
  "name": "my-app",
  "description": "My Application Project",
  "cwd": ".",
  "tags": ["frontend", "react", "typescript"],
  "claude": {
    "model": "claude-opus-5",
    "systemPrompt": "专注 React 开发"
  }
}
```

---

## 配置继承

```
全局配置 (config.json)
    ↓ 被覆盖
项目配置 (.voxbridge.json)
    ↓ 被覆盖
命令行参数
```

---

## 优缺点

| 优点 | 缺点 |
|------|------|
| ✅ 项目级配置 | ❌ 需创建配置文件 |
| ✅ 与代码一起管理 | ❌ 新项目需配置 |
| ✅ 配置可继承 | |

---

## 适用场景

- ✅ 多项目管理
- ✅ 需要项目级配置覆盖
- ✅ 团队协作
- ❌ 临时项目 → 方案 A