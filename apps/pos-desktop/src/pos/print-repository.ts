import type { LocalDatabaseBridge } from './tauri-bridge.js';
import type { PrintJob } from './print-job.js';

export interface PrintRepository {
  claimPending(limit: number, maxAttempts: number, workerId: string, leaseMs: number): Promise<PrintJob[]>;
  markPrinted(id: string, workerId: string): Promise<void>;
  markFailed(id: string, workerId: string, message: string): Promise<void>;
}

export function createSqlitePrintRepository(db: LocalDatabaseBridge): PrintRepository {
  return {
    claimPending: async (limit, maxAttempts, workerId, leaseMs) => {
      const leaseSeconds = Math.max(1, Math.ceil(leaseMs / 1000));

      await db.execute(
        `UPDATE print_jobs
         SET status = 'PENDING', locked_by = NULL, locked_until = NULL, updated_at = datetime('now')
         WHERE status = 'PRINTING'
           AND locked_until IS NOT NULL
           AND locked_until <= datetime('now')`,
      );

      await db.execute(
        `UPDATE print_jobs
         SET status = 'PRINTING', locked_by = ?,
             locked_until = datetime('now', ? || ' seconds'), updated_at = datetime('now')
         WHERE id IN (
           SELECT id
           FROM print_jobs
           WHERE status IN ('PENDING','FAILED')
             AND attempts < ?
           ORDER BY created_at ASC
           LIMIT ?
         )`,
        [workerId, leaseSeconds, maxAttempts, limit],
      );

      return db.query<PrintJob>(
        `SELECT id, order_id AS orderId, station, payload, status, attempts, last_error AS lastError,
                created_at AS createdAt, locked_by AS lockedBy, locked_until AS lockedUntil
         FROM print_jobs
         WHERE status = 'PRINTING' AND locked_by = ?
         ORDER BY created_at ASC`,
        [workerId],
      );
    },

    markPrinted: (id, workerId) => db.execute(
      `UPDATE print_jobs
       SET status = 'PRINTED', locked_by = NULL, locked_until = NULL,
           last_error = NULL, updated_at = datetime('now')
       WHERE id = ? AND status = 'PRINTING' AND locked_by = ?`,
      [id, workerId],
    ),

    markFailed: (id, workerId, message) => db.execute(
      `UPDATE print_jobs
       SET status = 'FAILED', attempts = attempts + 1,
           locked_by = NULL, locked_until = NULL,
           last_error = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'PRINTING' AND locked_by = ?`,
      [message, id, workerId],
    ),
  };
}
