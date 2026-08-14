import { test } from "node:test";
import assert from "node:assert/strict";
import { ExecutorRegistry } from "../src/executor/registry.js";

test("acquire creates a new executor on first use", async () => {
  const registry = new ExecutorRegistry();
  const entry = await registry.acquire("chat-a", { cwd: "/tmp/project" });

  assert.equal(registry.peek("chat-a"), entry);
  assert.equal(entry.executor.chatId, "chat-a");
  assert.equal(entry.executor.cwd, "/tmp/project");
  assert.equal(entry.executor.isDisposed, false);
  assert.equal(entry.leases, 1);
});

test("acquire reuses the existing executor for the same chat", async () => {
  const registry = new ExecutorRegistry();
  const first = await registry.acquire("chat-a", { cwd: "/tmp" });
  const second = await registry.acquire("chat-a", { cwd: "/tmp" });

  assert.equal(first, second);
  assert.equal(second.leases, 2);
});

test("release disposes and removes an executor when idleTimeoutMs is unset", async () => {
  const registry = new ExecutorRegistry(); // no idle timeout -> dispose on release
  const entry = await registry.acquire("chat-a", { cwd: "/tmp" });

  await registry.release("chat-a", "done");

  assert.equal(registry.peek("chat-a"), undefined);
  assert.equal(entry.executor.isDisposed, true);
});

test("release of an unknown chat is a no-op", async () => {
  const registry = new ExecutorRegistry();
  await registry.release("ghost", "cleanup");
  assert.equal(registry.peek("ghost"), undefined);
});

test("idle timeout fires and disposes a released executor", async () => {
  const registry = new ExecutorRegistry({ idleTimeoutMs: 50 });
  const entry = await registry.acquire("chat-a", { cwd: "/tmp" });

  await registry.release("chat-a", "idle start");

  // Still pooled immediately after release...
  assert.equal(registry.peek("chat-a"), entry);

  // ...but disposed once the idle timer elapses.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(registry.peek("chat-a"), undefined);
  assert.equal(entry.executor.isDisposed, true);
});

test("re-acquire before the idle timeout reuses the pooled instance", async () => {
  const registry = new ExecutorRegistry({ idleTimeoutMs: 50 });
  const first = await registry.acquire("chat-a", { cwd: "/tmp" });

  await registry.release("chat-a", "between turns");
  const second = await registry.acquire("chat-a", { cwd: "/tmp" });

  assert.equal(first, second);
  assert.equal(second.executor.isDisposed, false);

  await registry.shutdownAll("cleanup");
});

test("shutdownAll clears the whole pool", async () => {
  const registry = new ExecutorRegistry();
  const a = await registry.acquire("chat-a", { cwd: "/1" });
  const b = await registry.acquire("chat-b", { cwd: "/2" });
  const c = await registry.acquire("chat-c", { cwd: "/3" });

  await registry.shutdownAll("app quit");

  assert.equal(registry.peek("chat-a"), undefined);
  assert.equal(registry.peek("chat-b"), undefined);
  assert.equal(registry.peek("chat-c"), undefined);
  assert.equal(a.executor.isDisposed, true);
  assert.equal(b.executor.isDisposed, true);
  assert.equal(c.executor.isDisposed, true);
});

test("shutdownAll is idempotent", async () => {
  const registry = new ExecutorRegistry();
  await registry.acquire("chat-a", { cwd: "/tmp" });

  await registry.shutdownAll("first call");
  await registry.shutdownAll("second call"); // must not throw
});

test("maxConcurrent evicts the least-recently-used idle executor", async () => {
  const registry = new ExecutorRegistry({ maxConcurrent: 1, idleTimeoutMs: 10_000 });
  const a = await registry.acquire("chat-a", { cwd: "/tmp" });
  await registry.release("chat-a", "done");

  const b = await registry.acquire("chat-b", { cwd: "/tmp" });

  assert.equal(registry.peek("chat-a"), undefined);
  assert.equal(a.executor.isDisposed, true);
  assert.equal(registry.peek("chat-b"), b);
});

test("maxConcurrent rejects when at capacity with nothing idle", async () => {
  const registry = new ExecutorRegistry({ maxConcurrent: 1 });
  await registry.acquire("chat-a", { cwd: "/tmp" });

  await assert.rejects(
    () => registry.acquire("chat-b", { cwd: "/tmp" }),
    /maxConcurrent/
  );
});

test("pooled executor drives cross-turn input through an AsyncQueue", async () => {
  const registry = new ExecutorRegistry();
  const entry = await registry.acquire("chat-a", { cwd: "/tmp" });

  entry.executor.send("turn one");
  entry.executor.send("turn two");

  const seen: string[] = [];
  const consumer = (async () => {
    for await (const message of entry.executor.queue) {
      seen.push(message);
    }
  })();

  await entry.executor.shutdown("session closed");
  await consumer;

  assert.deepEqual(seen, ["turn one", "turn two"]);
});

test("sending to a disposed executor throws", async () => {
  const registry = new ExecutorRegistry();
  const entry = await registry.acquire("chat-a", { cwd: "/tmp" });

  await registry.release("chat-a", "done");

  assert.throws(() => entry.executor.send("too late"), /disposed/);
});