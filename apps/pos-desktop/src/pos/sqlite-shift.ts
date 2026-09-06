import type { LocalDatabaseBridge } from './tauri-bridge.js';
import { getPosRuntimeIdentity } from './runtime-identity.js';
import type { Shift } from './shift.js';

interface ShiftRow {
  id: string;
  branch_id: string;
  device_id: string;
  cashier_id: string;
  status: 'OPEN' | 'CLOSED';
  opened_at: string;
  closed_at: string | null;
}

function mapShift(row: ShiftRow): Shift {
  return {
    id: row.id,
    branchId: row.branch_id,
    deviceId: row.device_id,
    cashierId: row.cashier_id,
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

type ShiftIdentity = Pick<Shift, 'branchId' | 'deviceId' | 'cashierId'>;

function assertRuntimeIdentity(identity: ShiftIdentity): ShiftIdentity {
  const runtime = getPosRuntimeIdentity();
  if (identity.branchId !== runtime.branchId || identity.deviceId !== runtime.deviceId || identity.cashierId !== runtime.cashierId) {
    throw new Error('Shift identity does not match the authenticated POS session');
  }
  return runtime;
}

export async function getOpenShift(
  db: LocalDatabaseBridge,
  identity?: ShiftIdentity,
): Promise<Shift | null> {
  const scoped = identity ? assertRuntimeIdentity(identity) : getPosRuntimeIdentity();
  const rows = await db.query<ShiftRow>(
    `SELECT id, branch_id, device_id, cashier_id, status, opened_at, closed_at
     FROM shifts
     WHERE branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN'
     ORDER BY opened_at DESC
     LIMIT 1`,
    [scoped.branchId, scoped.deviceId, scoped.cashierId],
  );
  return rows.length ? mapShift(rows[0]) : null;
}

export async function openLocalShift(
  db: LocalDatabaseBridge,
  shift: Shift,
): Promise<Shift> {
  const scoped = assertRuntimeIdentity(shift);
  await db.transaction([
    {
      sql: `INSERT INTO shifts (
        id, branch_id, device_id, cashier_id, status, opened_at, closed_at
      )
      SELECT ?, ?, ?, ?, 'OPEN', ?, NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM shifts
        WHERE branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN'
      )`,
      params: [
        shift.id,
        scoped.branchId,
        scoped.deviceId,
        scoped.cashierId,
        shift.openedAt,
        scoped.branchId,
        scoped.deviceId,
        scoped.cashierId,
      ],
    },
  ]);

  const existing = await getOpenShift(db);
  if (!existing) throw new Error('Failed to open cashier shift');
  return existing;
}

export async function closeLocalShift(
  db: LocalDatabaseBridge,
  shiftId: string,
  closedAt: string,
): Promise<void> {
  const scoped = getPosRuntimeIdentity();
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM shifts
     WHERE id = ? AND branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN'
     LIMIT 1`,
    [shiftId, scoped.branchId, scoped.deviceId, scoped.cashierId],
  );
  if (!rows.length) throw new Error('Shift is not open for the authenticated POS session');

  await db.execute(
    `UPDATE shifts
     SET status = 'CLOSED', closed_at = ?
     WHERE id = ? AND branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN'`,
    [closedAt, shiftId, scoped.branchId, scoped.deviceId, scoped.cashierId],
  );
}
