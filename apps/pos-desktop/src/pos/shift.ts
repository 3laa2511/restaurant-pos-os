export type ShiftStatus = 'OPEN' | 'CLOSED';

export interface Shift {
  id: string;
  branchId: string;
  deviceId: string;
  cashierId: string;
  status: ShiftStatus;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  variance: number | null;
  openedAt: string;
  closedAt: string | null;
}

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export function openShift(input: { id: string; branchId: string; deviceId: string; cashierId: string; openingCash?: number; now?: Date }): Shift {
  if (!input.id || !input.branchId || !input.deviceId || !input.cashierId) throw new Error('Shift identity is required');
  const openingCash = money(input.openingCash ?? 0);
  if (!Number.isFinite(openingCash) || openingCash < 0 || Math.abs(openingCash * 100 - Math.round(openingCash * 100)) > Number.EPSILON) {
    throw new Error('Opening cash must be a non-negative amount with at most 2 decimals');
  }
  return { id: input.id, branchId: input.branchId, deviceId: input.deviceId, cashierId: input.cashierId, status: 'OPEN', openingCash, closingCash: null, expectedCash: null, variance: null, openedAt: (input.now ?? new Date()).toISOString(), closedAt: null };
}

export function requestShiftClose(shift: Shift, reconciliation?: { expectedCash: number; actualCash: number; closedAt?: Date }): Shift {
  if (shift.status !== 'OPEN') throw new Error(`Shift is not open: ${shift.status}`);
  if (!reconciliation) throw new Error('Cash reconciliation is required before closing the shift');
  const expectedCash = money(reconciliation.expectedCash);
  const actualCash = money(reconciliation.actualCash);
  return { ...shift, status: 'CLOSED', expectedCash, closingCash: actualCash, variance: money(actualCash - expectedCash), closedAt: (reconciliation.closedAt ?? new Date()).toISOString() };
}
