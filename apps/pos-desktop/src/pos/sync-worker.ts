import { SyncOrchestrator } from './sync-orchestrator.js';
import type { SyncRepository } from './sync-repository.js';
import type { SyncQueueItem, SyncTransport } from './sync-contract.js';
import { ExponentialRetryPolicy } from './retry-policy.js';

export type { SyncQueueItem, SyncTransport } from './sync-contract.js';

export interface SyncWorkerOptions {
  batchSize?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  workerId?: string;
  leaseMs?: number;
}

export interface SyncWorkerRuntimeOptions extends SyncWorkerOptions {
  repository: SyncRepository;
  transport: SyncTransport;
  intervalMs?: number;
}

export interface SyncWorkerRuntime { stop(): void; }

export class OfflineSyncWorker {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly orchestrator: SyncOrchestrator;
  private readonly retryPolicy: ExponentialRetryPolicy;

  constructor(repository: SyncRepository, transport: SyncTransport, options: SyncWorkerOptions = {}) {
    this.orchestrator = new SyncOrchestrator(repository, transport, options);
    this.retryPolicy = new ExponentialRetryPolicy({ baseDelayMs: options.baseDelayMs, maxDelayMs: options.maxDelayMs });
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const result = await this.orchestrator.runOnce();
      if (result.failedAttempts !== null) {
        await new Promise((resolve) => setTimeout(resolve, this.retryPolicy.delayFor(result.failedAttempts)));
      }
      return result.synced;
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 2000): () => void {
    let stopped = false;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try { await this.runOnce(); } catch { /* durable queue retains work */ }
      if (!stopped) this.timer = setTimeout(() => void tick(), intervalMs);
    };
    void tick();
    return () => { stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; };
  }
}

export function createHttpSyncTransport(apiBaseUrl: string, fetcher: typeof fetch = fetch): SyncTransport {
  const base = apiBaseUrl.replace(/\/$/, '');
  return {
    async push(item: SyncQueueItem): Promise<void> {
      const payload = JSON.parse(item.payload) as Record<string, unknown>;
      const response = await fetcher(`${base}/api/sync/operations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          deviceId: payload.deviceId ?? 'unknown-device',
          branchId: payload.branchId ?? 'unknown-branch',
          operation: item.operation,
          entityType: item.entity_type,
          entityId: item.entity_id,
          idempotencyKey: item.idempotency_key,
          clientSequence: item.client_sequence,
          occurredAt: payload.createdAt ?? item.created_at,
          payload,
        }),
      });
      if (!response.ok) throw new Error(`Sync HTTP ${response.status}`);
      const result = await response.json().catch(() => null) as { status?: string } | null;
      if (result?.status === 'CONFLICT' || result?.status === 'REJECTED') throw new Error(`Sync ${result.status.toLowerCase()}`);
    },
  };
}

export function createSyncWorkerRuntime(options: SyncWorkerRuntimeOptions): SyncWorkerRuntime {
  const worker = new OfflineSyncWorker(options.repository, options.transport, options);
  return { stop: worker.start(options.intervalMs ?? 2000) };
}
