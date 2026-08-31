export type ShiftStatus = 'OPEN' | 'CLOSED';

export interface Shift {
  id: string;
  branchId: string;
  deviceId: string;
  cashierId: string;
  status: ShiftStatus;
  openedAt: string;
  closedAt: string | null;
}

export function openShift(input: { id: string; branchId: string; deviceId: string; cashierId: string; now?: Date }): Shift {
  if (!input.id || !input.branchId || !input.deviceId || !input.cashierId) throw new Error('Shift identity is required');
  return { id: input.id, branchId: input.branchId, deviceId: input.deviceId, cashierId: input.cashierId, status: 'OPEN', openedAt: (input.now ?? new Date()).toISOString(), closedAt: null };
}

export function requestShiftClose(shift: Shift): Shift {
  if (shift.status !== 'OPEN') throw new Error(`Shift is not open: ${shift.status}`);
  return { ...shift, status: 'CLOSED', closedAt: new Date().toISOString() };
}
