import type { LocalDatabaseBridge } from './tauri-bridge.js';
import type { SyncQueueItem } from './sync-contract.js';

export interface SyncRepository {
  getPending(limit: number, maxAttempts: number, workerId: string, leaseMs: number): Promise<SyncQueueItem[]>;
  markSynced(id: string): Promise<void>;
  markFailed(id: string, message: string): Promise<void>;
}

export function createSqliteSyncRepository(db: LocalDatabaseBridge): SyncRepository {
  return {
    getPending: async (limit, maxAttempts, workerId, leaseMs) => {
      const leaseSeconds = Math.max(1, Math.ceil(leaseMs / 1000));
      await db.execute(
        `UPDATE sync_queue
         SET status = 'PENDING', locked_by = NULL, locked_until = NULL, updated_at = datetime('now')
         WHERE status = 'SYNCING'
           AND locked_until IS NOT NULL
           AND locked_until <= datetime('now')`,
      );

      await db.execute(
        `UPDATE sync_queue
         SET status = 'SYNCING', locked_by = ?,
             locked_until = datetime('now', ? || ' seconds'), updated_at = datetime('now')
         WHERE id IN (
           SELECT id
           FROM sync_queue
           WHERE status IN ('PENDING','FAILED')
             AND attempts < ?
           ORDER BY client_sequence ASC
           LIMIT ?
         )`,
        [workerId, leaseSeconds, maxAttempts, limit],
      );

      return db.query<SyncQueueItem>(
        `SELECT id, entity_type, entity_id, operation, idempotency_key,
                client_sequence, payload, status, attempts, last_error,
                created_at, updated_at
         FROM sync_queue
         WHERE status = 'SYNCING' AND locked_by = ?
         ORDER BY client_sequence ASC`,
        [workerId],
      );
    },
    markSynced: (id) => db.execute(
      `UPDATE sync_queue
       SET status = 'SYNCED', locked_by = NULL, locked_until = NULL,
           last_error = NULL, updated_at = datetime('now')
       WHERE id = ? AND status = 'SYNCING'`,
      [id],
    ),
    markFailed: (id, message) => db.execute(
      `UPDATE sync_queue
       SET status = 'FAILED', attempts = attempts + 1,
           locked_by = NULL, locked_until = NULL,
           last_error = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'SYNCING'`,
      [message, id],
    ),
  };
}
