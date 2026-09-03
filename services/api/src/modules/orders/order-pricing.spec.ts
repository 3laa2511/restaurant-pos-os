import { describe, expect, it } from '@jest/globals';
import { calculateOrderPricing } from './order-pricing.js';

describe('calculateOrderPricing', () => {
  it('calculates modifiers, percentage discount, tax and service fee deterministically', () => {
    const result = calculateOrderPricing(
      [{
        productId: 'burger',
        quantity: 2,
        unitPrice: 100,
        modifiers: [{ id: 'cheese', name: 'Cheese', unitPrice: 15, quantity: 1 }],
      }],
      { discount: { kind: 'PERCENT', value: 10 }, taxRatePercent: 14, serviceFeeRatePercent: 5 },
    );

    expect(result).toEqual({
      subtotal: 230,
      discount: 23,
      taxable: 207,
      tax: 28.98,
      serviceFee: 10.35,
      deliveryFee: 0,
      total: 246.33,
    });
  });

  it('caps a fixed discount at the subtotal', () => {
    expect(calculateOrderPricing(
      [{ productId: 'x', quantity: 1, unitPrice: 50 }],
      { discount: { kind: 'FIXED', value: 100 } },
    ).total).toBe(0);
  });

  it('rejects invalid quantities and rates', () => {
    expect(() => calculateOrderPricing([{ productId: 'x', quantity: 0, unitPrice: 50 }])).toThrow('Invalid quantity');
    expect(() => calculateOrderPricing([{ productId: 'x', quantity: 1, unitPrice: 50 }], { taxRatePercent: -1 })).toThrow('taxRatePercent');
    expect(() => calculateOrderPricing([{ productId: 'x', quantity: 1, unitPrice: 50 }], { discount: { kind: 'PERCENT', value: 101 } })).toThrow('Discount percentage');
  });

  it('supports delivery fees without mutating the subtotal', () => {
    const result = calculateOrderPricing(
      [{ productId: 'x', quantity: 1, unitPrice: 75 }],
      { deliveryFee: 25 },
    );
    expect(result.subtotal).toBe(75);
    expect(result.deliveryFee).toBe(25);
    expect(result.total).toBe(100);
  });
});
