import type { LocalDatabaseBridge } from './tauri-bridge.js';
import type { PosRuntimeIdentity } from './runtime-identity.js';

export type LocalCashMovementType = 'OPENING_FLOAT' | 'SALE' | 'CASH_CHANGE' | 'REFUND' | 'PAY_IN' | 'PAY_OUT' | 'ADJUSTMENT';
export type LocalCashDirection = 'IN' | 'OUT';

export interface CashDrawerMovementInput {
  id: string;
  shiftId: string;
  type: LocalCashMovementType;
  direction: LocalCashDirection;
  amount: number;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  reason?: string | null;
  occurredAt?: string;
}

export interface CashDrawerReconciliation {
  openingCash: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  actualCash: number | null;
  variance: number | null;
  movementCount: number;
}

const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100);
const money = (value: number): number => cents(value) / 100;

function assertMoney(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 100 - Math.round(value * 100)) > Number.EPSILON) {
    throw new Error('Cash drawer amount must be positive and use at most 2 decimals');
  }
}

export async function recordCashDrawerMovement(
  db: LocalDatabaseBridge,
  identity: PosRuntimeIdentity,
  input: CashDrawerMovementInput,
): Promise<void> {
  assertMoney(input.amount);
  if (!input.shiftId || !input.id || !input.idempotencyKey) throw new Error('Cash drawer movement identity is required');
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM cash_drawer_movements WHERE idempotency_key = ? LIMIT 1',
    [input.idempotencyKey],
  );
  if (existing.length) return;

  await db.execute(
    `INSERT INTO cash_drawer_movements (
      id, branch_id, device_id, shift_id, cashier_id, type, direction, amount,
      source_type, source_id, idempotency_key, reason, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      identity.branchId,
      identity.deviceId,
      input.shiftId,
      identity.cashierId,
      input.type,
      input.direction,
      money(input.amount),
      input.sourceType,
      input.sourceId,
      input.idempotencyKey,
      input.reason ?? null,
      input.occurredAt ?? new Date().toISOString(),
    ],
  );
}

export async function reconcileLocalCashDrawer(
  db: LocalDatabaseBridge,
  shiftId: string,
  actualCash?: number,
): Promise<CashDrawerReconciliation> {
  const rows = await db.query<{ opening_cash: number; cash_in: number; cash_out: number; movement_count: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'OPENING_FLOAT' AND direction = 'IN' THEN amount ELSE 0 END), 0) AS opening_cash,
       COALESCE(SUM(CASE WHEN direction = 'IN' AND type != 'OPENING_FLOAT' THEN amount ELSE 0 END), 0) AS cash_in,
       COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END), 0) AS cash_out,
       COUNT(*) AS movement_count
     FROM cash_drawer_movements
     WHERE shift_id = ?`,
    [shiftId],
  );
  const row = rows[0] ?? { opening_cash: 0, cash_in: 0, cash_out: 0, movement_count: 0 };
  const expectedCash = money(Number(row.opening_cash) + Number(row.cash_in) - Number(row.cash_out));
  const actual = actualCash === undefined ? null : money(actualCash);
  return {
    openingCash: money(Number(row.opening_cash)),
    cashIn: money(Number(row.cash_in)),
    cashOut: money(Number(row.cash_out)),
    expectedCash,
    actualCash: actual,
    variance: actual === null ? null : money(actual - expectedCash),
    movementCount: Number(row.movement_count),
  };
}
