import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, formatError, isRecoverable } from "../src/executor/errors.js";
import {
  MAX_CRASHES,
  handleCrash,
  resetCrashCount,
  getCrashCount,
} from "../src/executor/crashRecovery.js";

// 匹配中文字符，用于验证 formatError 返回的是中文消息
const CJK = /[一-鿿]/;

test("ErrorCode 包含全部 7 个错误码", () => {
  const codes = Object.values(ErrorCode);
  assert.equal(codes.length, 7);
  assert.ok(codes.includes("EC_MIC_UNAVAILABLE"));
  assert.ok(codes.includes("EC_MODEL_MISSING"));
  assert.ok(codes.includes("EC_CC_NOT_FOUND"));
  assert.ok(codes.includes("EC_CC_CRASH"));
  assert.ok(codes.includes("EC_SDK_STREAM"));
  assert.ok(codes.includes("EC_RESUME_FAILED"));
  assert.ok(codes.includes("EC_WORKER_CRASH"));
});

test("formatError 为每个错误码返回中文消息", () => {
  for (const code of Object.values(ErrorCode)) {
    const message = formatError(code);
    assert.ok(typeof message === "string");
    assert.ok(message.length > 0, `错误码 ${code} 的消息不应为空`);
    assert.ok(CJK.test(message), `错误码 ${code} 的消息应为中文：${message}`);
  }
});

test("formatError 支持附加 details", () => {
  const withDetails = formatError(ErrorCode.EC_CC_CRASH, "exit code 1");
  assert.ok(withDetails.includes("exit code 1"));
  assert.ok(withDetails.includes(formatError(ErrorCode.EC_CC_CRASH)));
});

test("isRecoverable 映射正确", () => {
  // 可恢复：进程/流/worker 崩溃
  assert.equal(isRecoverable(ErrorCode.EC_CC_CRASH), true);
  assert.equal(isRecoverable(ErrorCode.EC_SDK_STREAM), true);
  assert.equal(isRecoverable(ErrorCode.EC_WORKER_CRASH), true);
  // 不可恢复：环境/配置类错误
  assert.equal(isRecoverable(ErrorCode.EC_MIC_UNAVAILABLE), false);
  assert.equal(isRecoverable(ErrorCode.EC_MODEL_MISSING), false);
  assert.equal(isRecoverable(ErrorCode.EC_CC_NOT_FOUND), false);
  assert.equal(isRecoverable(ErrorCode.EC_RESUME_FAILED), false);
});

test("crashRecovery：handleCrash 递增计数并在第 3 次达到上限", () => {
  const key = "chat:test-max";
  resetCrashCount(key);
  assert.equal(getCrashCount(key), 0);

  // 前两次返回 true（允许恢复）
  assert.equal(handleCrash(key), true, "第 1 次崩溃后应允许恢复");
  assert.equal(getCrashCount(key), 1);
  assert.equal(handleCrash(key), true, "第 2 次崩溃后应允许恢复");
  assert.equal(getCrashCount(key), 2);

  // 第 MAX_CRASHES 次崩溃达到上限，返回 false
  assert.equal(handleCrash(key), false, "第 3 次崩溃后应达到上限");
  assert.equal(getCrashCount(key), MAX_CRASHES);
  assert.equal(getCrashCount(key), 3);

  // 上限之后继续返回 false
  assert.equal(handleCrash(key), false, "超出上限后不应再允许恢复");
});

test("crashRecovery：resetCrashCount 后重新允许恢复", () => {
  const key = "chat:test-reset";
  resetCrashCount(key);

  handleCrash(key);
  handleCrash(key);
  assert.equal(handleCrash(key), false, "第 3 次崩溃应达到上限");
  assert.equal(getCrashCount(key), MAX_CRASHES);

  // 成功恢复后重置计数
  resetCrashCount(key);
  assert.equal(getCrashCount(key), 0, "reset 后计数应归零");
  assert.equal(handleCrash(key), true, "reset 后应重新允许恢复");
  assert.equal(getCrashCount(key), 1);
});

test("crashRecovery：不同 key 的崩溃计数相互独立", () => {
  const keyA = "chat:a";
  const keyB = "worker:b";
  resetCrashCount(keyA);
  resetCrashCount(keyB);

  handleCrash(keyA);
  handleCrash(keyA);
  handleCrash(keyA);
  assert.equal(getCrashCount(keyA), MAX_CRASHES);

  // keyB 不受 keyA 崩溃影响
  assert.equal(getCrashCount(keyB), 0);
  assert.equal(handleCrash(keyB), true, "keyB 未达上限应允许恢复");
});