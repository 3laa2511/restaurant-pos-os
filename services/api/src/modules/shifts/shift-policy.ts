export type ShiftStatus = 'OPEN' | 'CLOSED';

export const MONEY_SCALE = 2;
export const MAX_MONEY = 9_999_999_999.99;

export interface Shift {
  id: string;
  branchId: string;
  cashierId: string;
  deviceId: string;
  status: ShiftStatus;
  openingCash: number;
  openedAt: Date;
  closedAt?: Date | null;
}

export function assertMoneyAmount(amount: number, field: string): void {
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > MAX_MONEY ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > Number.EPSILON
  ) {
    throw new Error(`${field} must be a non-negative amount with at most 2 decimal places`);
  }
}

export function validateOpenShift(input: Pick<Shift, 'branchId' | 'cashierId' | 'deviceId' | 'openingCash'>): void {
  if (!input.branchId.trim() || !input.cashierId.trim() || !input.deviceId.trim()) {
    throw new Error('Branch, cashier and device are required');
  }
  assertMoneyAmount(input.openingCash, 'Opening cash');
}

export function assertShiftCanClose(shift: Shift): void {
  if (shift.status !== 'OPEN') throw new Error('Shift is already closed');
}
