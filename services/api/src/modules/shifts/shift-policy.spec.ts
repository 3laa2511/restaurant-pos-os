import { describe, expect, it } from '@jest/globals';
import { assertMoneyAmount, assertShiftCanClose, MAX_MONEY, validateOpenShift } from './shift-policy.js';

describe('shift policy', () => {
  it('accepts valid money at two-decimal precision', () => {
    expect(() => assertMoneyAmount(0, 'Cash')).not.toThrow();
    expect(() => assertMoneyAmount(1234.56, 'Cash')).not.toThrow();
    expect(() => assertMoneyAmount(MAX_MONEY, 'Cash')).not.toThrow();
  });

  it('rejects negative, non-finite, oversized, and over-precision money', () => {
    for (const value of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, MAX_MONEY + 0.01, 10.001]) {
      expect(() => assertMoneyAmount(value, 'Cash')).toThrow('at most 2 decimal places');
    }
  });

  it('requires branch, cashier, and device for opening a shift', () => {
    expect(() => validateOpenShift({ branchId: ' ', cashierId: 'cashier-1', deviceId: 'device-1', openingCash: 100 })).toThrow('required');
    expect(() => validateOpenShift({ branchId: 'branch-1', cashierId: '', deviceId: 'device-1', openingCash: 100 })).toThrow('required');
    expect(() => validateOpenShift({ branchId: 'branch-1', cashierId: 'cashier-1', deviceId: ' ', openingCash: 100 })).toThrow('required');
  });

  it('applies money validation to opening cash', () => {
    expect(() => validateOpenShift({ branchId: 'branch-1', cashierId: 'cashier-1', deviceId: 'device-1', openingCash: 10.001 })).toThrow('at most 2 decimal places');
  });

  it('allows closing only an OPEN shift', () => {
    expect(() => assertShiftCanClose({
      id: 'shift-1', branchId: 'branch-1', cashierId: 'cashier-1', deviceId: 'device-1',
      status: 'OPEN', openingCash: 100, openedAt: new Date(), closedAt: null,
    })).not.toThrow();
  });

  it('rejects closing an already CLOSED shift', () => {
    expect(() => assertShiftCanClose({
      id: 'shift-1', branchId: 'branch-1', cashierId: 'cashier-1', deviceId: 'device-1',
      status: 'CLOSED', openingCash: 100, openedAt: new Date(), closedAt: new Date(),
    })).toThrow('already closed');
  });
});
