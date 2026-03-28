/**
 * Concurrency limiter that caps the number of in-flight async tasks.
 * Tasks beyond the limit are queued and started as earlier ones finish.
 */
class ConcurrencyLimiter {
  private queue: Array<() => void> = [];
  private activeCount = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Execute an async function with concurrency limiting.
   * Resolves/rejects with the same value as `fn`.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for a free slot
    if (this.activeCount >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      // Release the next queued task, if any
      this.queue.shift()?.();
    }
  }

  /** Number of tasks waiting in the queue. */
  getQueueSize(): number {
    return this.queue.length;
  }

  /** Drop all queued (not yet started) tasks. */
  clear() {
    this.queue = [];
  }
}

// Global instance shared across all STAC registration requests.
// Allows up to 6 concurrent requests (browser per-host limit is typically 6).
export const stacRegistrationLimiter = new ConcurrencyLimiter(6);
