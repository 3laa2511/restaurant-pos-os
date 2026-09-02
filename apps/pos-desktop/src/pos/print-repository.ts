import type { LocalDatabaseBridge } from './tauri-bridge.js';
import type { PrintJob } from './print-job.js';
import type { PrintReliabilityRepository, PrintReliabilitySnapshot } from './print-reliability.js';

export interface PrintRepository {
  claimPending(limit: number, maxAttempts: number, workerId: string, leaseMs: number): Promise<PrintJob[]>;
  markPrinted(id: string, workerId: string): Promise<void>;
  markFailed(id: string, workerId: string, message: string): Promise<void>;
}

function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function createSqlitePrintRepository(db: LocalDatabaseBridge): PrintReliabilityRepository {
  return {
    claimPending: async (limit, maxAttempts, workerId, leaseMs) => {
      const safeLimit = normalizePositiveInteger(limit, 'Print claim limit');
      const safeMaxAttempts = normalizePositiveInteger(maxAttempts, 'Print max attempts');
      const safeLeaseMs = normalizePositiveInteger(leaseMs, 'Print lease duration');
      const normalizedWorkerId = workerId.trim();
      if (!normalizedWorkerId) throw new Error('Print worker id is required');
      const leaseSeconds = Math.max(1, Math.ceil(safeLeaseMs / 1000));

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
           WHERE status IN ('PENDING', 'FAILED')
             AND attempts < ?
           ORDER BY created_at ASC
           LIMIT ?
         )`,
        [normalizedWorkerId, leaseSeconds, safeMaxAttempts, safeLimit],
      );

      return db.query<PrintJob>(
        `SELECT id,
                order_id AS orderId,
                order_number AS orderNumber,
                station,
                copies,
                payload,
                status,
                attempts,
                last_error AS lastError,
                created_at AS createdAt,
                locked_by AS lockedBy,
                locked_until AS lockedUntil
         FROM print_jobs
         WHERE status = 'PRINTING' AND locked_by = ?
         ORDER BY created_at ASC`,
        [normalizedWorkerId],
      );
    },

    markPrinted: async (id, workerId) => {
      const result = await db.query<{ id: string }>(
        `UPDATE print_jobs
         SET status = 'PRINTED', locked_by = NULL, locked_until = NULL,
             last_error = NULL, updated_at = datetime('now')
         WHERE id = ? AND status = 'PRINTING' AND locked_by = ?
         RETURNING id`,
        [id, workerId],
      );
      if (result.length !== 1) throw new Error('Print job ownership lost before completion');
    },

    markFailed: async (id, workerId, message) => {
      const result = await db.query<{ id: string }>(
        `UPDATE print_jobs
         SET status = 'FAILED', attempts = attempts + 1,
             locked_by = NULL, locked_until = NULL,
             last_error = ?, updated_at = datetime('now')
         WHERE id = ? AND status = 'PRINTING' AND locked_by = ?
         RETURNING id`,
        [message.slice(0, 2000), id, workerId],
      );
      if (result.length !== 1) throw new Error('Print job ownership lost before failure recording');
    },

    recoverExpired: async () => {
      const result = await db.query<{ id: string }>(
        `UPDATE print_jobs
         SET status = 'PENDING', locked_by = NULL, locked_until = NULL,
             updated_at = datetime('now')
         WHERE status = 'PRINTING'
           AND locked_until IS NOT NULL
           AND locked_until <= datetime('now')
         RETURNING id`,
      );
      return result.length;
    },

    getSnapshot: async (): Promise<PrintReliabilitySnapshot> => {
      const rows = await db.query<{ status: PrintReliabilitySnapshot[keyof PrintReliabilitySnapshot]; count: number }>(
        `SELECT status, COUNT(*) AS count
         FROM print_jobs
         GROUP BY status`,
      );
      const snapshot: PrintReliabilitySnapshot = { pending: 0, printing: 0, printed: 0, failed: 0 };
      for (const row of rows) {
        if (row.status === 'PENDING') snapshot.pending = row.count;
        else if (row.status === 'PRINTING') snapshot.printing = row.count;
        else if (row.status === 'PRINTED') snapshot.printed = row.count;
        else if (row.status === 'FAILED') snapshot.failed = row.count;
      }
      return snapshot;
    },
  };
}
