import type { OrderType } from './types.js';
import type { DiscountKind } from './pricing.js';

export interface DiscountRule {
  id: string;
  kind: DiscountKind;
  value: number;
  maxDiscount?: number | null;
  minSubtotal?: number;
  orderTypes?: OrderType[];
  productIds?: string[];
  categoryIds?: string[];
  requiresApproval?: boolean;
  active: boolean;
}

export interface DiscountContext {
  subtotal: number;
  orderType: OrderType;
  items: Array<{ productId: string; categoryId: string }>;
}

export interface DiscountDecision {
  ruleId: string;
  amount: number;
  requiresApproval: boolean;
}

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function assertNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a finite non-negative number`);
}

export function evaluateDiscount(rule: DiscountRule, context: DiscountContext): DiscountDecision {
  if (!rule.active) throw new Error('Discount rule is inactive');
  assertNonNegative(context.subtotal, 'subtotal');
  assertNonNegative(rule.value, 'discount value');
  if (rule.maxDiscount != null) assertNonNegative(rule.maxDiscount, 'max discount');
  if (rule.minSubtotal != null) assertNonNegative(rule.minSubtotal, 'min subtotal');

  if (rule.minSubtotal != null && context.subtotal < rule.minSubtotal) throw new Error('Order does not meet discount minimum');
  if (rule.orderTypes?.length && !rule.orderTypes.includes(context.orderType)) throw new Error('Discount is not valid for this order type');

  const hasProductScope = Boolean(rule.productIds?.length);
  const hasCategoryScope = Boolean(rule.categoryIds?.length);
  if (hasProductScope || hasCategoryScope) {
    const eligible = context.items.some((item) =>
      (hasProductScope && rule.productIds!.includes(item.productId)) ||
      (hasCategoryScope && rule.categoryIds!.includes(item.categoryId)),
    );
    if (!eligible) throw new Error('No order item is eligible for this discount');
  }

  let amount = rule.kind === 'PERCENT'
    ? context.subtotal * Math.min(rule.value, 100) / 100
    : Math.min(rule.value, context.subtotal);
  if (rule.maxDiscount != null) amount = Math.min(amount, rule.maxDiscount);

  return {
    ruleId: rule.id,
    amount: roundMoney(Math.min(amount, context.subtotal)),
    requiresApproval: rule.requiresApproval ?? false,
  };
}
