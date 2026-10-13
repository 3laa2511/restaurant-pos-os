import { SyncOrchestrator } from './sync-orchestrator.js';
import type { SyncRepository } from './sync-repository.js';
import type { SyncQueueItem, SyncTransport } from './sync-contract.js';
import { assertSyncAcknowledgement } from '../../../../services/api/src/modules/sync/sync-contract.js';
import { ExponentialRetryPolicy } from './retry-policy.js';
import { getAccessToken } from './auth-client.js';
import { getPosRuntimeIdentity } from './runtime-identity.js';

export type { SyncQueueItem, SyncTransport } from './sync-contract.js';
export interface SyncWorkerOptions { batchSize?: number; maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number; workerId?: string; leaseMs?: number; }
export interface SyncWorkerRuntimeOptions extends SyncWorkerOptions { repository: SyncRepository; transport: SyncTransport; intervalMs?: number; onError?: (error: unknown) => void; }
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
      const failedAttempts = result.failedAttempts ?? 0;
      if (failedAttempts > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.retryPolicy.delayFor(failedAttempts)));
      }
      return result.synced;
    } finally { this.running = false; }
  }
  start(intervalMs = 2000, onError?: (error: unknown) => void): () => void {
    let stopped = false;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try { await this.runOnce(); } catch (error) {
        // Keep retrying durable work, but expose failures to the host UI/logging.
        try { onError?.(error); } catch { /* observer failures must not stop sync */ }
      }
      if (!stopped) this.timer = setTimeout(() => void tick(), intervalMs);
    };
    void tick();
    return () => { stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; };
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Sync payload field ${field} is required`);
  return value.trim();
}

export interface HttpSyncTransportOptions { requestTimeoutMs?: number; }

export function createHttpSyncTransport(apiBaseUrl: string, fetcher: typeof fetch = fetch, accessTokenProvider: () => string | null = getAccessToken, options: HttpSyncTransportOptions = {}): SyncTransport {
  const base = apiBaseUrl.replace(/\/$/, '');
  const requestTimeoutMs = Math.max(1000, options.requestTimeoutMs ?? 10_000);
  return {
    async push(item: SyncQueueItem): Promise<void> {
      const payload = JSON.parse(item.payload) as Record<string, unknown>;
      const runtime = getPosRuntimeIdentity();
      const deviceId = requireNonEmptyString(runtime.deviceId, 'deviceId');
      const branchId = requireNonEmptyString(runtime.branchId, 'branchId');
      const token = accessTokenProvider();
      if (!token) throw new Error('Sync requires an authenticated desktop session');
      const headers: Record<string, string> = { 'content-type': 'application/json', Authorization: `Bearer ${token}` };
      const endpoint = item.entity_type === 'KITCHEN_TICKET' ? `${base}/api/kitchen/tickets/sync` : `${base}/api/sync/operations`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: 'POST', headers, signal: controller.signal,
          body: JSON.stringify({ id: item.id, deviceId, branchId, operation: item.operation, entityType: item.entity_type, entityId: item.entity_id, idempotencyKey: item.idempotency_key, clientSequence: item.client_sequence, occurredAt: payload.createdAt ?? item.created_at, payload }),
        });
      } catch (error) {
        if (controller.signal.aborted) throw new Error(`Sync request timed out after ${requestTimeoutMs}ms`);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      const result: unknown = await response.json().catch(() => null);
      assertSyncAcknowledgement(response.status, result);
    },
  };
}

export function createSyncWorkerRuntime(options: SyncWorkerRuntimeOptions): SyncWorkerRuntime {
  const worker = new OfflineSyncWorker(options.repository, options.transport, options);
  return { stop: worker.start(options.intervalMs ?? 2000, options.onError) };
}
