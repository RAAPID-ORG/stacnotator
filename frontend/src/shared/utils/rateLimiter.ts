/**
 * Rate limiter that limits the number of requests per second across all instances
 */
class RateLimiter {
  private queue: Array<() => void> = [];
  private activeRequests = 0;
  private maxRequestsPerSecond: number;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(maxRequestsPerSecond: number) {
    this.maxRequestsPerSecond = maxRequestsPerSecond;
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          this.activeRequests++;
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeRequests--;
        }
      });

      this.processQueue();
    });
  }

  private processQueue() {
    if (!this.processingInterval) {
      this.processingInterval = setInterval(() => {
        this.processNextBatch();
      }, 1000 / this.maxRequestsPerSecond);
    }

    // Process immediately if we have capacity
    this.processNextBatch();
  }

  private processNextBatch() {
    if (this.queue.length === 0) {
      // Stop the interval if queue is empty
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
        this.processingInterval = null;
      }
      return;
    }

    // Execute next request if we have capacity
    const nextRequest = this.queue.shift();
    if (nextRequest) {
      nextRequest();
    }
  }

  /**
   * Get the current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Clear the queue (useful for cleanup)
   */
  clear() {
    this.queue = [];
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }
}

// Global instance shared across all STAC registration requests
export const stacRegistrationLimiter = new RateLimiter(5);
