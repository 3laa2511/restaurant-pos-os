import type { LocalDatabaseBridge } from './tauri-bridge.js';
import { getPosRuntimeIdentity } from './runtime-identity.js';
import { reconcileLocalCashDrawer, recordCashDrawerMovement } from './sqlite-cash-drawer.js';
import type { Shift } from './shift.js';

interface ShiftRow {
  id: string;
  branch_id: string;
  device_id: string;
  cashier_id: string;
  status: 'OPEN' | 'CLOSED';
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
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
    openingCash: Number(row.opening_cash),
    closingCash: row.closing_cash === null ? null : Number(row.closing_cash),
    expectedCash: row.expected_cash === null ? null : Number(row.expected_cash),
    variance: row.variance === null ? null : Number(row.variance),
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

export async function getOpenShift(db: LocalDatabaseBridge, identity?: ShiftIdentity): Promise<Shift | null> {
  const scoped = identity ? assertRuntimeIdentity(identity) : getPosRuntimeIdentity();
  const rows = await db.query<ShiftRow>(
    `SELECT id, branch_id, device_id, cashier_id, status, opening_cash, closing_cash, expected_cash, variance, opened_at, closed_at
     FROM shifts
     WHERE branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN'
     ORDER BY opened_at DESC LIMIT 1`,
    [scoped.branchId, scoped.deviceId, scoped.cashierId],
  );
  return rows.length ? mapShift(rows[0]) : null;
}

export async function openLocalShift(db: LocalDatabaseBridge, shift: Shift): Promise<Shift> {
  const scoped = assertRuntimeIdentity(shift);
  await db.transaction([
    {
      sql: `INSERT INTO shifts (id, branch_id, device_id, cashier_id, status, opening_cash, opened_at, closed_at, closing_cash, expected_cash, variance)
            SELECT ?, ?, ?, ?, 'OPEN', ?, ?, NULL, NULL, NULL, NULL
            WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN')`,
      params: [shift.id, scoped.branchId, scoped.deviceId, scoped.cashierId, shift.openingCash, shift.openedAt, scoped.branchId, scoped.deviceId, scoped.cashierId],
    },
  ]);
  const existing = await getOpenShift(db);
  if (!existing) throw new Error('Failed to open cashier shift');
  await recordCashDrawerMovement(db, scoped as ReturnType<typeof getPosRuntimeIdentity>, {
    id: `${existing.id}:opening`, shiftId: existing.id, type: 'OPENING_FLOAT', direction: 'IN', amount: existing.openingCash,
    sourceType: 'SHIFT', sourceId: existing.id, idempotencyKey: `${existing.id}:opening`, reason: `Opening float for shift ${existing.id}`, occurredAt: existing.openedAt,
  });
  return existing;
}

export async function closeLocalShift(db: LocalDatabaseBridge, shiftId: string, closingCash: number, closedAt: string): Promise<Shift> {
  const scoped = getPosRuntimeIdentity();
  const rows = await db.query<ShiftRow>(
    `SELECT id, branch_id, device_id, cashier_id, status, opening_cash, closing_cash, expected_cash, variance, opened_at, closed_at
     FROM shifts WHERE id = ? AND branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN' LIMIT 1`,
    [shiftId, scoped.branchId, scoped.deviceId, scoped.cashierId],
  );
  if (!rows.length) throw new Error('Shift is not open for the authenticated POS session');
  const reconciliation = await reconcileLocalCashDrawer(db, shiftId, closingCash);
  if (reconciliation.movementCount === 0) throw new Error('Shift has no cash drawer ledger; cannot close safely');
  await db.execute(
    `UPDATE shifts SET status = 'CLOSED', closed_at = ?, closing_cash = ?, expected_cash = ?, variance = ?
     WHERE id = ? AND branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN'`,
    [closedAt, reconciliation.actualCash, reconciliation.expectedCash, reconciliation.variance, shiftId, scoped.branchId, scoped.deviceId, scoped.cashierId],
  );
  const closed = await db.query<ShiftRow>(
    `SELECT id, branch_id, device_id, cashier_id, status, opening_cash, closing_cash, expected_cash, variance, opened_at, closed_at FROM shifts WHERE id = ? LIMIT 1`,
    [shiftId],
  );
  if (!closed.length) throw new Error('Closed shift could not be reloaded');
  return mapShift(closed[0]);
}
