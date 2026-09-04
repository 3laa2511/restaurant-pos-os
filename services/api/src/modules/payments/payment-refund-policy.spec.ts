import { describe, expect, it } from '@jest/globals';
import { paymentStatusAfterAdjustment, validateRefund } from './payment-refund-policy.js';

describe('payment refund policy', () => {
  it('allows a partial refund within the remaining amount', () => {
    expect(() => validateRefund({
      paymentAmount: 250,
      alreadyRefunded: 50,
      requestedAmount: 100,
      type: 'REFUND',
      reason: 'Customer returned item',
    })).not.toThrow();
    expect(paymentStatusAfterAdjustment(250, 50, 100, 'REFUND')).toBe('PARTIALLY_REFUNDED');
  });

  it('marks a full refund as REFUNDED', () => {
    expect(paymentStatusAfterAdjustment(250, 0, 250, 'REFUND')).toBe('REFUNDED');
  });

  it('requires a void to reverse the full remaining payment', () => {
    expect(() => validateRefund({
      paymentAmount: 250,
      alreadyRefunded: 0,
      requestedAmount: 249.99,
      type: 'VOID',
      reason: 'Duplicate charge',
    })).toThrow('full remaining payment amount');
    expect(paymentStatusAfterAdjustment(250, 0, 250, 'VOID')).toBe('VOIDED');
  });

  it('rejects over-refunds and missing reasons', () => {
    expect(() => validateRefund({
      paymentAmount: 100,
      alreadyRefunded: 60,
      requestedAmount: 41,
      type: 'REFUND',
      reason: 'Return',
    })).toThrow('remaining refundable amount');

    expect(() => validateRefund({
      paymentAmount: 100,
      alreadyRefunded: 0,
      requestedAmount: 10,
      type: 'REFUND',
      reason: '   ',
    })).toThrow('reason is required');
  });

  it('rejects monetary values with more than two decimal places', () => {
    expect(() => validateRefund({
      paymentAmount: 100,
      alreadyRefunded: 0,
      requestedAmount: 10.001,
      type: 'REFUND',
      reason: 'Return',
    })).toThrow('at most 2 decimal places');
  });
});
