export type ShiftStatus = 'OPEN' | 'CLOSED';

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

export function validateOpenShift(input: Pick<Shift, 'branchId' | 'cashierId' | 'deviceId' | 'openingCash'>): void {
  if (!input.branchId.trim() || !input.cashierId.trim() || !input.deviceId.trim()) {
    throw new Error('Branch, cashier and device are required');
  }
  if (!Number.isFinite(input.openingCash) || input.openingCash < 0) {
    throw new Error('Opening cash must be non-negative');
  }
}

export function assertShiftCanClose(shift: Shift): void {
  if (shift.status !== 'OPEN') throw new Error('Shift is already closed');
}
