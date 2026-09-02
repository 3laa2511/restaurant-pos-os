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

  constructor(
    private readonly repository: SyncRepository,
    private readonly transport: SyncTransport,
    private readonly options: SyncOrchestratorOptions = {},
  ) {
    this.workerId = options.workerId ?? crypto.randomUUID();
    this.leaseMs = options.leaseMs ?? 30_000;
  }

  async runOnce(): Promise<SyncRunResult> {
    const batchSize = this.options.batchSize ?? 25;
    const maxRetries = this.options.maxRetries ?? 8;
    const items = await this.repository.getPending(batchSize, maxRetries, this.workerId, this.leaseMs);

    let synced = 0;
    let failed = 0;
    let failedAttempts: number | null = null;

    for (const item of items) {
      try {
        await this.transport.push(item);
        await this.repository.markSynced(item.id);
        synced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.repository.markFailed(item.id, message);
        failed += 1;
        failedAttempts = item.attempts + 1;
        break;
      }
    }

    return { attempted: items.length, synced, failed, failedAttempts };
  }
}
