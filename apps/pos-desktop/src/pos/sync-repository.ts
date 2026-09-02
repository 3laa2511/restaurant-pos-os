import type { LocalDatabaseBridge } from './tauri-bridge.js';
import type { SyncQueueItem } from './sync-contract.js';

export interface SyncRepository {
  getPending(limit: number, maxAttempts: number): Promise<SyncQueueItem[]>;
  markSynced(id: string): Promise<void>;
  markFailed(id: string, message: string): Promise<void>;
}

export function createSqliteSyncRepository(db: LocalDatabaseBridge): SyncRepository {
  return {
    getPending: (limit, maxAttempts) => db.query<SyncQueueItem>(
      `SELECT id, entity_type, entity_id, operation, idempotency_key,
              client_sequence, payload, status, attempts, last_error,
              created_at, updated_at
       FROM sync_queue
       WHERE status IN ('PENDING','FAILED') AND attempts < ?
       ORDER BY client_sequence ASC
       LIMIT ?`,
      [maxAttempts, limit],
    ),
    markSynced: (id) => db.execute(
      `UPDATE sync_queue
       SET status = 'SYNCED', last_error = NULL, updated_at = datetime('now')
       WHERE id = ? AND status IN ('PENDING','FAILED')`,
      [id],
    ),
    markFailed: (id, message) => db.execute(
      `UPDATE sync_queue
       SET status = 'FAILED', attempts = attempts + 1, last_error = ?, updated_at = datetime('now')
       WHERE id = ? AND status IN ('PENDING','FAILED')`,
      [message, id],
    ),
  };
}
