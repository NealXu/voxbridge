# ink TUI 模式

> P3-1：基于 React 19 + ink 7.1.1 的富交互界面，替代默认 console UI。

## 架构

```
config.ui.mode === "ink"
  └─► src/ui/index.ts:createUI("ink")
       └─► src/ui/ink/index.tsx:createInkUI()
            ├─ 动态 import("ink")（ESM-only）
            ├─ ink.render(<App />)
            └─ 返回 UI 接口实现（store 写入）

src/ui/ink/
  ├─ App.tsx            # 根组件，订阅 store 重渲染
  ├─ StatusBar.tsx      # 状态栏（按 theme 变色）
  ├─ RecognitionPanel.tsx # 识别结果（圆角边框）
  ├─ OutputPanel.tsx    # agent 输出流
  ├─ store.ts           # pub/sub 状态 + history + theme
  ├─ theme.ts           # 3 套主题色定义 + 选择器
  └─ index.tsx          # createInkUI() + fallback UI
```

## 主题系统

`config.ui.theme` 支持 3 个值：

| theme | 状态就绪 | 录音 | 错误 | 用途 |
|---|---|---|---|---|
| `default` | green | yellow | red | 标准终端 |
| `high-contrast` | greenBright | yellowBright | redBright | 高亮屏幕/色弱 |
| `monochrome` | white | white | white | 黑白屏/打印 |

切换：`{ "ui": { "mode": "ink", "theme": "high-contrast" } }`

## 历史记录

`store.appendHistory({prompt, response?})` 维护最近 50 条语音识别记录。超上限丢弃最旧的。UI 暂未渲染（后续 P3 扩展用 HistoryPanel）。

## 降级策略

ink 加载失败自动降级到 `createFallbackUI()`：纯 ANSI 彩色 + `[ink-fallback]` 前缀。

## 验证

`tests/inkStore.test.ts`（7 个）+ `tests/inkTheme.test.ts`（6 个）+ `tests/inkWiring.test.ts`（4 个）= 17 个测试。

手动：`config.ui.mode = "ink"` → 重启 → 按 F9 验证状态栏 / 识别框 / 输出流。

## 故障排查

**ink 加载失败**：`npm install`；或切 `mode: "console"`。

**主题不生效**：检查拼写，非法值回退 default。

**历史不保留**：仅内存，重启丢失。
