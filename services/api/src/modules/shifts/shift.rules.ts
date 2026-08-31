export type ShiftStatus = 'OPEN' | 'CLOSED';

export interface ShiftSnapshot {
  id: string;
  branchId: string;
  userId: string;
  status: ShiftStatus;
  openingCash: number;
  closingCash: number | null;
}

export function canOpenShift(existingOpenShift: ShiftSnapshot | null): boolean {
  return existingOpenShift === null;
}

export function canCloseShift(shift: ShiftSnapshot): boolean {
  return shift.status === 'OPEN';
}

export function assertClosingAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Closing cash must be a valid non-negative amount');
  }
}
