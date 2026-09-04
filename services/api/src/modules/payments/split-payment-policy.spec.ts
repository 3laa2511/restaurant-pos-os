import { describe, expect, it } from '@jest/globals';
import { validateSplitPayment } from './split-payment-policy.js';

describe('validateSplitPayment', () => {
  it('accepts exact mixed cash and card allocation', () => {
    expect(validateSplitPayment({
      orderId: 'order-1',
      shiftId: 'shift-1',
      totalDue: 250,
      allocations: [
        { method: 'CASH', amount: 100 },
        { method: 'CARD', amount: 150, reference: 'card-123' },
      ],
    })).toEqual({ totalAllocated: 250, remaining: 0, cashReceived: 100, change: 0 });
  });

  it('calculates change only from the cash allocation', () => {
    expect(validateSplitPayment({
      orderId: 'order-2',
      shiftId: 'shift-2',
      totalDue: 300,
      allocations: [
        { method: 'CASH', amount: 120, receivedCash: 150 },
        { method: 'WALLET', amount: 180, reference: 'wallet-9' },
      ],
    }).change).toBe(30);
  });

  it('rejects underpayment and overpayment', () => {
    const base = { orderId: 'order-3', shiftId: 'shift-3', totalDue: 100 } as const;
    expect(() => validateSplitPayment({ ...base, allocations: [{ method: 'CASH', amount: 99 }] })).toThrow('do not cover');
    expect(() => validateSplitPayment({ ...base, allocations: [{ method: 'CASH', amount: 101 }] })).toThrow('exceed');
  });

  it('requires references for non-cash allocations', () => {
    expect(() => validateSplitPayment({
      orderId: 'order-4',
      shiftId: 'shift-4',
      totalDue: 100,
      allocations: [{ method: 'CARD', amount: 100 }],
    })).toThrow('reference');
  });

  it('rejects cash received below the cash allocation', () => {
    expect(() => validateSplitPayment({
      orderId: 'order-5',
      shiftId: 'shift-5',
      totalDue: 100,
      allocations: [{ method: 'CASH', amount: 100, receivedCash: 99 }],
    })).toThrow('Insufficient cash');
  });

  it('rejects receivedCash on non-cash allocations', () => {
    expect(() => validateSplitPayment({
      orderId: 'order-6',
      shiftId: 'shift-6',
      totalDue: 100,
      allocations: [{ method: 'CARD', amount: 100, reference: 'card-1', receivedCash: 100 }],
    })).toThrow('only valid for cash');
  });

  it('uses cent arithmetic for decimal allocations', () => {
    const result = validateSplitPayment({
      orderId: 'order-7',
      shiftId: 'shift-7',
      totalDue: 10.01,
      allocations: [
        { method: 'CASH', amount: 3.33, receivedCash: 3.5 },
        { method: 'CARD', amount: 6.68, reference: 'card-7' },
      ],
    });
    expect(result.totalAllocated).toBe(10.01);
    expect(result.change).toBe(0.17);
  });
});
