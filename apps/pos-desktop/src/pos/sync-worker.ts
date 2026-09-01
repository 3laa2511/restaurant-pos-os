import type { SyncQueueItem, SyncTransport } from './sync-contract.js';
import { ExponentialRetryPolicy } from './retry-policy.js';
import type { SyncRepository } from './sync-repository.js';

export type { SyncQueueItem, SyncTransport } from './sync-contract.js';

export interface SyncWorkerOptions {
  batchSize?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class OfflineSyncWorker {
  private running = false;
  private readonly retryPolicy: ExponentialRetryPolicy;

  constructor(
    private readonly repository: SyncRepository,
    private readonly transport: SyncTransport,
    private readonly options: SyncWorkerOptions = {},
  ) {
    this.retryPolicy = new ExponentialRetryPolicy({
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
    });
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const batchSize = this.options.batchSize ?? 25;
      const maxRetries = this.options.maxRetries ?? 8;
      const items = await this.repository.getPending(batchSize, maxRetries);

      let completed = 0;
      for (const item of items) {
        try {
          await this.transport.push(item);
          await this.repository.markSynced(item.id);
          completed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.repository.markFailed(item.id, message);
          await new Promise((resolve) => setTimeout(resolve, this.retryPolicy.delayFor(item.retry_count)));
          break;
        }
      }
      return completed;
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 2000): () => void {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await this.runOnce();
      if (!stopped) setTimeout(tick, intervalMs);
    };
    void tick();
    return () => { stopped = true; };
  }
}
