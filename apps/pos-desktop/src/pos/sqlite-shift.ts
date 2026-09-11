import type { LocalDatabaseBridge } from './tauri-bridge.js';
import { getPosRuntimeIdentity } from './runtime-identity.js';
import type { PosRuntimeIdentity } from './runtime-identity.js';
import { reconcileLocalCashDrawer } from './sqlite-cash-drawer.js';
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

type ShiftIdentity = Pick<Shift, 'branchId' | 'deviceId' | 'cashierId'>;

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function mapShift(row: ShiftRow): Shift {
  return {
    id: row.id,
    branchId: row.branch_id,
    deviceId: row.device_id,
    cashierId: row.cashier_id,
    status: row.status,
    openingCash: money(Number(row.opening_cash)),
    closingCash: row.closing_cash === null ? null : money(Number(row.closing_cash)),
    expectedCash: row.expected_cash === null ? null : money(Number(row.expected_cash)),
    variance: row.variance === null ? null : money(Number(row.variance)),
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

function assertCash(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > Number.EPSILON) {
    throw new Error(`${label} must be a non-negative amount with at most 2 decimals`);
  }
}

function assertRuntimeIdentity(identity: ShiftIdentity): PosRuntimeIdentity {
  const runtime = getPosRuntimeIdentity();
  if (identity.branchId !== runtime.branchId || identity.deviceId !== runtime.deviceId || identity.cashierId !== runtime.cashierId) {
    throw new Error('Shift identity does not match the authenticated POS session');
  }
  return runtime;
}

export async function getOpenShift(db: LocalDatabaseBridge, identity?: ShiftIdentity): Promise<Shift | null> {
  const scoped = identity ? assertRuntimeIdentity(identity) : getPosRuntimeIdentity();
  const rows = await db.query<ShiftRow>(
    `SELECT id, branch_id, device_id, cashier_id, status, opening_cash,
            closing_cash, expected_cash, variance, opened_at, closed_at
     FROM shifts
     WHERE branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN'
     ORDER BY opened_at DESC LIMIT 1`,
    [scoped.branchId, scoped.deviceId, scoped.cashierId],
  );
  return rows[0] ? mapShift(rows[0]) : null;
}

export async function openLocalShift(db: LocalDatabaseBridge, shift: Shift): Promise<Shift> {
  const scoped = assertRuntimeIdentity(shift);
  assertCash(shift.openingCash, 'Opening cash');

  await db.transaction([
    {
      sql: `INSERT INTO shifts (
        id, branch_id, device_id, cashier_id, status, opening_cash,
        opened_at, closed_at, closing_cash, expected_cash, variance
      ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, NULL, NULL, NULL, NULL)`,
      params: [shift.id, scoped.branchId, scoped.deviceId, scoped.cashierId, money(shift.openingCash), shift.openedAt],
    },
    {
      sql: `INSERT INTO cash_drawer_movements (
        id, branch_id, device_id, shift_id, cashier_id, type, direction, amount,
        source_type, source_id, idempotency_key, reason, occurred_at
      ) SELECT ?, ?, ?, ?, ?, 'OPENING_FLOAT', 'IN', ?, 'SHIFT', ?, ?, ?, ?
      WHERE ? > 0`,
      params: [
        `${shift.id}:opening`, scoped.branchId, scoped.deviceId, shift.id, scoped.cashierId,
        money(shift.openingCash), shift.id, `${shift.id}:opening`, `Opening float for shift ${shift.id}`, shift.openedAt,
        money(shift.openingCash),
      ],
    },
  ]);

  const opened = await db.query<ShiftRow>(
    `SELECT id, branch_id, device_id, cashier_id, status, opening_cash,
            closing_cash, expected_cash, variance, opened_at, closed_at
     FROM shifts WHERE id = ? LIMIT 1`,
    [shift.id],
  );
  if (!opened[0]) throw new Error('Opened shift could not be reloaded');
  return mapShift(opened[0]);
}

export async function closeLocalShift(
  db: LocalDatabaseBridge,
  shiftId: string,
  closedAt: string,
  closingCash?: number,
): Promise<Shift> {
  const scoped = getPosRuntimeIdentity();
  if (closingCash === undefined) throw new Error('Actual closing cash is required');
  assertCash(closingCash, 'Actual closing cash');

  const rows = await db.query<ShiftRow>(
    `SELECT id, branch_id, device_id, cashier_id, status, opening_cash,
            closing_cash, expected_cash, variance, opened_at, closed_at
     FROM shifts
     WHERE id = ? AND branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN'
     LIMIT 1`,
    [shiftId, scoped.branchId, scoped.deviceId, scoped.cashierId],
  );
  if (!rows[0]) throw new Error('Shift is not open for the authenticated POS session');

  const reconciliation = await reconcileLocalCashDrawer(db, shiftId, closingCash);
  await db.transaction([
    {
      sql: `UPDATE shifts
            SET status = 'CLOSED', closed_at = ?, closing_cash = ?, expected_cash = ?, variance = ?
            WHERE id = ? AND branch_id = ? AND device_id = ? AND cashier_id = ? AND status = 'OPEN'`,
      params: [
        closedAt,
        reconciliation.actualCash,
        reconciliation.expectedCash,
        reconciliation.variance,
        shiftId,
        scoped.branchId,
        scoped.deviceId,
        scoped.cashierId,
      ],
    },
  ]);

  const closed = await db.query<ShiftRow>(
    `SELECT id, branch_id, device_id, cashier_id, status, opening_cash,
            closing_cash, expected_cash, variance, opened_at, closed_at
     FROM shifts WHERE id = ? LIMIT 1`,
    [shiftId],
  );
  if (!closed[0] || closed[0].status !== 'CLOSED') throw new Error('Closed shift could not be reloaded');
  return mapShift(closed[0]);
}
