import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncQueue } from "../src/executor/inputQueue.js";

test("AsyncQueue yields items in FIFO order", async () => {
  const queue = new AsyncQueue<string>();
  queue.enqueue("first");
  queue.enqueue("second");
  queue.enqueue("third");
  queue.finish();

  const items: string[] = [];
  for await (const item of queue) {
    items.push(item);
  }

  assert.deepEqual(items, ["first", "second", "third"]);
});

test("AsyncQueue handles finish signal correctly", async () => {
  const queue = new AsyncQueue<number>();
  queue.enqueue(1);
  queue.enqueue(2);
  queue.finish();

  const items: number[] = [];
  for await (const item of queue) {
    items.push(item);
  }

  assert.deepEqual(items, [1, 2]);
  assert.equal(queue.isFinished, true);
});

test("AsyncQueue completes iteration after finish with empty queue", async () => {
  const queue = new AsyncQueue<string>();
  queue.finish();

  const items: string[] = [];
  for await (const item of queue) {
    items.push(item);
  }

  assert.deepEqual(items, []);
  assert.equal(queue.isFinished, true);
});

test("AsyncQueue waits when empty", async () => {
  const queue = new AsyncQueue<string>();
  const items: string[] = [];

  // Start consuming in background
  const consumerPromise = (async () => {
    for await (const item of queue) {
      items.push(item);
    }
  })();

  // Wait a bit to ensure consumer is waiting
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Verify nothing has been consumed yet
  assert.deepEqual(items, []);

  // Enqueue items after delay
  queue.enqueue("delayed1");
  queue.enqueue("delayed2");
  queue.finish();

  await consumerPromise;

  assert.deepEqual(items, ["delayed1", "delayed2"]);
});

test("AsyncQueue handles interleaved enqueue and consume", async () => {
  const queue = new AsyncQueue<number>();
  const items: number[] = [];

  // Start consumer
  const consumerPromise = (async () => {
    for await (const item of queue) {
      items.push(item);
    }
  })();

  // Enqueue items with small delays
  queue.enqueue(1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  queue.enqueue(2);
  await new Promise((resolve) => setTimeout(resolve, 5));
  queue.enqueue(3);
  queue.finish();

  await consumerPromise;

  assert.deepEqual(items, [1, 2, 3]);
});

test("AsyncQueue throws when enqueueing after finish", () => {
  const queue = new AsyncQueue<string>();
  queue.finish();

  assert.throws(
    () => queue.enqueue("too late"),
    /Cannot enqueue to a finished queue/
  );
});

test("AsyncQueue handles multiple consumers waiting", async () => {
  const queue = new AsyncQueue<number>();
  const results1: number[] = [];
  const results2: number[] = [];

  // Start two consumers
  const consumer1 = (async () => {
    for await (const item of queue) {
      results1.push(item);
    }
  })();

  const consumer2 = (async () => {
    for await (const item of queue) {
      results2.push(item);
    }
  })();

  // Enqueue items
  queue.enqueue(1);
  queue.enqueue(2);
  queue.enqueue(3);
  queue.finish();

  await Promise.all([consumer1, consumer2]);

  // Items should be distributed between consumers
  const totalConsumed = results1.length + results2.length;
  assert.equal(totalConsumed, 3, "All items should be consumed");

  // Each item should be consumed exactly once
  const allItems = [...results1, ...results2].sort();
  assert.deepEqual(allItems, [1, 2, 3]);
});

test("AsyncQueue length tracks items correctly", () => {
  const queue = new AsyncQueue<string>();

  assert.equal(queue.length, 0);

  queue.enqueue("a");
  assert.equal(queue.length, 1);

  queue.enqueue("b");
  assert.equal(queue.length, 2);
});

test("AsyncQueue handles single item", async () => {
  const queue = new AsyncQueue<string>();
  queue.enqueue("only");
  queue.finish();

  const items: string[] = [];
  for await (const item of queue) {
    items.push(item);
  }

  assert.deepEqual(items, ["only"]);
});

test("AsyncQueue handles rapid enqueue before consume", async () => {
  const queue = new AsyncQueue<number>();

  // Rapidly enqueue all items before any consumer starts
  for (let i = 0; i < 100; i++) {
    queue.enqueue(i);
  }
  queue.finish();

  const items: number[] = [];
  for await (const item of queue) {
    items.push(item);
  }

  assert.equal(items.length, 100);
  assert.equal(items[0], 0);
  assert.equal(items[99], 99);
});

test("AsyncQueue blocks consumer until finish is called on empty queue", async () => {
  const queue = new AsyncQueue<string>();
  let consumerCompleted = false;

  const consumerPromise = (async () => {
    for await (const item of queue) {
      // This should not run - queue is empty
      assert.fail("Should not yield any items");
    }
    consumerCompleted = true;
  })();

  // Consumer should be waiting
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(consumerCompleted, false, "Consumer should be waiting");

  // Signal finish
  queue.finish();

  await consumerPromise;
  assert.equal(consumerCompleted, true, "Consumer should complete after finish");
});