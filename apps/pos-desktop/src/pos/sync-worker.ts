import { SyncOrchestrator } from './sync-orchestrator.js';
import type { SyncRepository } from './sync-repository.js';
import type { SyncTransport } from './sync-contract.js';

export type { SyncQueueItem, SyncTransport } from './sync-contract.js';

export interface SyncWorkerOptions {
  batchSize?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class OfflineSyncWorker {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly orchestrator: SyncOrchestrator;

  constructor(
    repository: SyncRepository,
    transport: SyncTransport,
    private readonly options: SyncWorkerOptions = {},
  ) {
    this.orchestrator = new SyncOrchestrator(repository, transport, options);
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const result = await this.orchestrator.runOnce();
      return result.synced;
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 2000): () => void {
    let stopped = false;

    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        await this.runOnce();
      } finally {
        if (!stopped) this.timer = setTimeout(() => void tick(), intervalMs);
      }
    };

    void tick();
    return () => {
      stopped = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    };
  }
}
