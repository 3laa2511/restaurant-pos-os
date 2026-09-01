import type { LocalDatabaseBridge } from './tauri-bridge.js';

export interface SyncQueueItem {
  id: string;
  device_id: string;
  branch_id: string;
  operation: string;
  entity_type: string;
  entity_id: string;
  idempotency_key: string;
  client_sequence: number;
  payload: string;
  occurred_at: string;
  status: string;
  retry_count: number;
  last_error: string | null;
}

export interface SyncTransport {
  push(item: SyncQueueItem): Promise<void>;
}

export interface SyncWorkerOptions {
  batchSize?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class OfflineSyncWorker {
  private running = false;

  constructor(private readonly db: LocalDatabaseBridge, private readonly transport: SyncTransport, private readonly options: SyncWorkerOptions = {}) {}

  private delayFor(item: SyncQueueItem): number {
    const base = this.options.baseDelayMs ?? 1000;
    const max = this.options.maxDelayMs ?? 30000;
    const exponent = Math.min(item.retry_count, 6);
    return Math.min(max, base * 2 ** exponent);
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const batchSize = this.options.batchSize ?? 25;
      const maxRetries = this.options.maxRetries ?? 8;
      const items = await this.db.query<SyncQueueItem>(
        `SELECT id, device_id, branch_id, operation, entity_type, entity_id, idempotency_key, client_sequence, payload, occurred_at, status, retry_count, last_error FROM sync_queue WHERE status = 'PENDING' AND retry_count < ? ORDER BY client_sequence ASC LIMIT ?`,
        [maxRetries, batchSize],
      );

      let completed = 0;
      for (const item of items) {
        try {
          await this.transport.push(item);
          await this.db.execute(`UPDATE sync_queue SET status = 'SYNCED', last_error = NULL WHERE id = ?`, [item.id]);
          completed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.db.execute(`UPDATE sync_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`, [message, item.id]);
          await new Promise((resolve) => setTimeout(resolve, this.delayFor(item)));
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
