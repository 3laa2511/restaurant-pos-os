import type { LocalDatabaseBridge } from './tauri-bridge.js';
import type { SyncQueueItem } from './sync-worker.js';

export interface SyncRepository {
  getPending(limit: number, maxRetries: number): Promise<SyncQueueItem[]>;
  markSynced(id: string): Promise<void>;
  markFailed(id: string, message: string): Promise<void>;
}

export function createSqliteSyncRepository(db: LocalDatabaseBridge): SyncRepository {
  return {
    getPending: (limit, maxRetries) => db.query<SyncQueueItem>(
      `SELECT id, device_id, branch_id, operation, entity_type, entity_id,
              idempotency_key, client_sequence, payload, occurred_at, status,
              retry_count, last_error
       FROM sync_queue
       WHERE status = 'PENDING' AND retry_count < ?
       ORDER BY client_sequence ASC
       LIMIT ?`,
      [maxRetries, limit],
    ),
    markSynced: (id) => db.execute(
      `UPDATE sync_queue
       SET status = 'SYNCED', last_error = NULL
       WHERE id = ? AND status = 'PENDING'`,
      [id],
    ),
    markFailed: (id, message) => db.execute(
      `UPDATE sync_queue
       SET retry_count = retry_count + 1, last_error = ?
       WHERE id = ? AND status = 'PENDING'`,
      [message, id],
    ),
  };
}
