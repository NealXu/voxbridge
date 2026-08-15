# 会话续接

> P1-2：重启后恢复上次会话；过期会话自动丢弃；resume 失败自动回退到新会话。

## 数据流

```
启动
  ├─ loadSession(SESSION_FILE, 7天TTL)
  │   ├─ valid    → lastSessionId = sid, 用于后续 send()
  │   ├─ expired  → log.warn + clearSessionId, 开启新会话
  │   └─ absent   → 开启新会话
  │
  └─ send(prompt)
      ├─ 首次 send 用 lastSessionId resume
      │   └─ SDK 返回 session-not-found 类错误
      │       → 清空 sessionId + 重试一次 + onSessionFallback()
      │
      └─ 成功完成 → saveSessionId 覆盖 updatedAt
```

## 关键机制

### 1. 7 天 TTL

`DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000`

`loadSession()` 返回判别联合 `"absent" | "expired" | "valid"`。启动时 expired 自动 clear + warn。

### 2. Resume 失败自动回退

`isResumeFailure(msg)` 检测 SDK 消息的 `subtype` / `errors` 含 "session" + "not found/expired/invalid"。匹配时：

1. 清空 `lastSessionId` + `clearSessionId(file)`
2. 触发 `callbacks.onSessionFallback(previousSessionId)`
3. 用 `undefined` sessionId 重发一次 prompt（新开 session）

### 3. UI 提示

`main.ts` 的 `onSessionFallback` 回调打印：

```
⚠ 会话续接失败（ID=abc12345…），已开启新会话
```

## 验证

### 单元测试

`tests/persistSession.test.ts`（9 个）：

- 文件不存在 → absent
- 合法 sessionId + 近期 updatedAt → valid
- updatedAt 超过 7 天 → expired
- 自定义 maxAgeMs 可缩短窗口
- 缺少 updatedAt → expired（保守）
- sessionId 为空 → absent
- 非法 JSON → absent
- DEFAULT_SESSION_TTL_MS = 7 天
- saveSessionId ↔ loadSession 往返

`tests/session.test.ts`（8 个）：流式文本、错误子类型、工具调用、状态流转、危险工具回调。

### 手动验证

```powershell
# 1. 启动 voxcode，发一句话（生成 session）
node dist/main.js
> "你好"

# 2. Ctrl+C 退出

# 3. 重启 → 应看到 log: "resuming session {sessionId: ...}"
node dist/main.js
# 发第二句 → sessionId 复用

# 4. 伪造过期：编辑 ~/.voxcode-session.json，把 updatedAt 改为 8 天前
# 重启 → 应看到 log: "session expired, starting new"

# 5. 伪造 resume 失败：把 sessionId 改成不存在的值 "invalid-sess-xyz"
# 发一句话 → 应看到 "会话续接失败（ID=invalid-…），已开启新会话"
```

## 故障排查

**会话不恢复**：检查 `~/.voxcode-session.json` 的 `updatedAt` 是否在 7 天内。超过会被自动丢弃。

**resume 反复失败**：可能是 Claude Agent SDK 端会话已被清理（服务端 30 天上限）。看 `~/.voxcode/logs/` 的 `resume failed` warn 日志。

**文件损坏**：`loadSession` 容错 JSON 解析错误，返回 absent 后开启新会话，不会崩溃。
