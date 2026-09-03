import { describe, expect, it } from '@jest/globals';
import { evaluateTaxFeePolicies } from './tax-fee-policy.js';

describe('evaluateTaxFeePolicies', () => {
  const context = { orderType: 'DINE_IN' as const, taxableAmount: 207 };

  it('calculates percentage tax and service fee deterministically', () => {
    expect(evaluateTaxFeePolicies(
      context,
      { id: 'vat', name: 'VAT', ratePercent: 14 },
      { id: 'service', name: 'Service', kind: 'PERCENT', value: 5 },
    )).toEqual({
      taxRuleId: 'vat',
      serviceFeeRuleId: 'service',
      tax: 28.98,
      serviceFee: 10.35,
      taxRatePercent: 14,
    });
  });

  it('respects order-type eligibility and exemption', () => {
    expect(evaluateTaxFeePolicies(
      { orderType: 'TAKEAWAY', taxableAmount: 100 },
      { id: 'vat', name: 'VAT', ratePercent: 14, orderTypes: ['DINE_IN'], exempt: false },
      { id: 'service', name: 'Service', kind: 'FIXED', value: 20, orderTypes: ['DINE_IN'] },
    )).toEqual({ taxRuleId: null, serviceFeeRuleId: null, tax: 0, serviceFee: 0, taxRatePercent: 0 });

    expect(evaluateTaxFeePolicies(
      { orderType: 'DINE_IN', taxableAmount: 100 },
      { id: 'vat', name: 'VAT', ratePercent: 14, exempt: true },
    )).toEqual({ taxRuleId: null, serviceFeeRuleId: null, tax: 0, serviceFee: 0, taxRatePercent: 0 });
  });

  it('caps a service fee and validates rates', () => {
    expect(evaluateTaxFeePolicies(
      context,
      undefined,
      { id: 'service', name: 'Service', kind: 'PERCENT', value: 20, maxAmount: 25 },
    ).serviceFee).toBe(25);

    expect(() => evaluateTaxFeePolicies(context, { id: 'vat', name: 'VAT', ratePercent: 101 })).toThrow('Tax rate');
    expect(() => evaluateTaxFeePolicies(context, undefined, { id: 'service', name: 'Service', kind: 'PERCENT', value: 101 })).toThrow('Service fee percentage');
  });
});
