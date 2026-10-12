import type { SyncTransport } from './sync-contract.js';
import type { SyncRepository } from './sync-repository.js';

export interface SyncOrchestratorOptions {
  batchSize?: number;
  maxRetries?: number;
  workerId?: string;
  leaseMs?: number;
}

export interface SyncRunResult {
  attempted: number;
  synced: number;
  failed: number;
  failedAttempts: number | null;
}

export class SyncOrchestrator {
  private readonly workerId: string;
  private readonly leaseMs: number;
  private running = false;

  constructor(
    private readonly repository: SyncRepository,
    private readonly transport: SyncTransport,
    private readonly options: SyncOrchestratorOptions = {},
  ) {
    this.workerId = options.workerId ?? crypto.randomUUID();
    this.leaseMs = options.leaseMs ?? 30_000;
  }

  async runOnce(): Promise<SyncRunResult> {
    // Do not let overlapping timer/manual triggers run the same worker concurrently.
    if (this.running) {
      return { attempted: 0, synced: 0, failed: 0, failedAttempts: null };
    }

    this.running = true;
    try {
      return await this.runBatch();
    } finally {
      this.running = false;
    }
  }

  private async runBatch(): Promise<SyncRunResult> {
    const batchSize = this.options.batchSize ?? 25;
    const maxRetries = this.options.maxRetries ?? 8;
    const items = await this.repository.getPending(batchSize, maxRetries, this.workerId, this.leaseMs);

    let attempted = 0;
    let synced = 0;
    let failed = 0;
    let failedAttempts: number | null = null;

    for (const item of items) {
      attempted += 1;
      try {
        await this.transport.push(item);
        await this.repository.markSynced(item.id, this.workerId);
        synced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.repository.markFailed(item.id, this.workerId, message);
        failed += 1;
        failedAttempts = item.attempts + 1;
        break;
      }
    }

    return { attempted, synced, failed, failedAttempts };
  }
}
