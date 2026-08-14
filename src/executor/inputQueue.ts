/**
 * AsyncQueue is a queue that supports async iteration.
 * Items can be enqueued from one or more producers, and consumed via async iteration.
 * The queue blocks when empty until items arrive or finish() is called.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private finished = false;
  /** Queue of pending pull requests waiting for items */
  private pullResolvers: ((result: IteratorResult<T>) => void)[] = [];

  /**
   * Enqueue an item to the queue.
   * If there are pending consumers waiting for items, they will be notified immediately.
   */
  enqueue(item: T): void {
    if (this.finished) {
      throw new Error("Cannot enqueue to a finished queue");
    }

    // If there's a waiting consumer, give the item directly to them
    if (this.pullResolvers.length > 0) {
      const resolve = this.pullResolvers.shift()!;
      resolve({ value: item, done: false });
      return;
    }

    // Otherwise, queue the item
    this.items.push(item);
  }

  /**
   * Signal that no more items will be enqueued.
   * After calling finish(), the async iterator will complete after all queued items are consumed.
   * Calling finish() when there are pending consumers will resolve them with done: true.
   */
  finish(): void {
    this.finished = true;
    // Notify all pending pull requests that the queue is finished
    while (this.pullResolvers.length > 0) {
      const resolve = this.pullResolvers.shift()!;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  /**
   * Async iterator implementation.
   * Yields items in FIFO order, waiting when the queue is empty.
   * Completes when the queue is finished and all items have been consumed.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      // If there are items, yield them immediately
      if (this.items.length > 0) {
        const item = this.items.shift()!;
        yield item;
        continue;
      }

      // No items available
      if (this.finished) {
        // Queue is finished and empty, iteration complete
        return;
      }

      // Wait for an item to be enqueued or queue to finish
      const result = await this.pull();
      if (result.done) {
        return;
      }
      yield result.value;
    }
  }

  /**
   * Pull an item from the queue, waiting if necessary.
   */
  private pull(): Promise<IteratorResult<T>> {
    return new Promise((resolve) => {
      // If there are items, resolve immediately
      if (this.items.length > 0) {
        const item = this.items.shift()!;
        resolve({ value: item, done: false });
        return;
      }

      // If queue is finished, resolve with done
      if (this.finished) {
        resolve({ value: undefined as unknown as T, done: true });
        return;
      }

      // Otherwise, wait for an item to be enqueued
      this.pullResolvers.push(resolve);
    });
  }

  /**
   * Get the current number of items in the queue.
   */
  get length(): number {
    return this.items.length;
  }

  /**
   * Check if the queue is finished (no more items will be enqueued).
   */
  get isFinished(): boolean {
    return this.finished;
  }
}