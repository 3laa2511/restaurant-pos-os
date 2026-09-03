import { describe, expect, it } from '@jest/globals';
import { evaluateDiscountRule } from './discount-rules.js';

describe('evaluateDiscountRule', () => {
  const context = {
    orderType: 'DINE_IN' as const,
    subtotal: 500,
    items: [{ productId: 'burger', categoryId: 'food', quantity: 2, lineTotal: 500 }],
  };

  it('applies a percentage rule deterministically', () => {
    expect(evaluateDiscountRule({ id: 'r1', name: 'Ten percent', kind: 'PERCENT', value: 10 }, context)).toEqual({
      ruleId: 'r1', eligible: true, discount: 50, reason: null, requiresApproval: false,
    });
  });

  it('caps a discount and never exceeds subtotal', () => {
    expect(evaluateDiscountRule({ id: 'r2', name: 'Large', kind: 'PERCENT', value: 50, maxDiscount: 100 }, context).discount).toBe(100);
    expect(evaluateDiscountRule({ id: 'r3', name: 'Fixed', kind: 'FIXED', value: 1000 }, context).discount).toBe(500);
  });

  it('enforces minimum subtotal and order type eligibility', () => {
    expect(evaluateDiscountRule({ id: 'r4', name: 'VIP', kind: 'FIXED', value: 50, minSubtotal: 600 }, context).reason).toBe('MIN_SUBTOTAL_NOT_MET');
    expect(evaluateDiscountRule({ id: 'r5', name: 'Delivery', kind: 'FIXED', value: 50, orderTypes: ['DELIVERY'] }, context).reason).toBe('ORDER_TYPE_NOT_ELIGIBLE');
  });

  it('enforces product/category eligibility and exposes approval requirement', () => {
    const result = evaluateDiscountRule({ id: 'r6', name: 'Burger deal', kind: 'FIXED', value: 75, productIds: ['burger'], requiresApproval: true }, context);
    expect(result).toEqual({ ruleId: 'r6', eligible: true, discount: 75, reason: null, requiresApproval: true });
    expect(evaluateDiscountRule({ id: 'r7', name: 'Pizza deal', kind: 'FIXED', value: 75, productIds: ['pizza'] }, context).reason).toBe('ITEM_NOT_ELIGIBLE');
  });

  it('rejects invalid rule values', () => {
    expect(() => evaluateDiscountRule({ id: 'bad', name: 'Bad', kind: 'PERCENT', value: 101 }, context)).toThrow('percentage');
  });
});
