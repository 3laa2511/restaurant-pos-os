export type DiscountRuleKind = 'FIXED' | 'PERCENT';
export type DiscountOrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

export interface DiscountRule {
  id: string;
  name: string;
  kind: DiscountRuleKind;
  value: number;
  maxDiscount?: number;
  minSubtotal?: number;
  orderTypes?: readonly DiscountOrderType[];
  productIds?: readonly string[];
  categoryIds?: readonly string[];
  requiresApproval?: boolean;
}

export interface DiscountContextItem {
  productId: string;
  categoryId: string;
  quantity: number;
  lineTotal: number;
}

export interface DiscountContext {
  orderType: DiscountOrderType;
  subtotal: number;
  items: readonly DiscountContextItem[];
}

export interface DiscountDecision {
  ruleId: string;
  eligible: boolean;
  discount: number;
  reason: string | null;
  requiresApproval: boolean;
}

function assertNonNegativeFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a finite non-negative number`);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasEligibleItem(rule: DiscountRule, items: readonly DiscountContextItem[]): boolean {
  const hasProductFilter = (rule.productIds?.length ?? 0) > 0;
  const hasCategoryFilter = (rule.categoryIds?.length ?? 0) > 0;
  if (!hasProductFilter && !hasCategoryFilter) return true;

  return items.some((item) =>
    (hasProductFilter && rule.productIds!.includes(item.productId)) ||
    (hasCategoryFilter && rule.categoryIds!.includes(item.categoryId)),
  );
}

function validateRule(rule: DiscountRule): void {
  if (!rule.id.trim()) throw new Error('Discount rule id is required');
  if (!rule.name.trim()) throw new Error('Discount rule name is required');
  if (rule.kind !== 'FIXED' && rule.kind !== 'PERCENT') throw new Error('Unsupported discount rule kind');
  assertNonNegativeFinite(rule.value, 'Discount rule value');
  if (rule.kind === 'PERCENT' && rule.value > 100) throw new Error('Discount rule percentage cannot exceed 100');
  if (rule.maxDiscount !== undefined) assertNonNegativeFinite(rule.maxDiscount, 'maxDiscount');
  if (rule.minSubtotal !== undefined) assertNonNegativeFinite(rule.minSubtotal, 'minSubtotal');
}

export function evaluateDiscountRule(rule: DiscountRule, context: DiscountContext): DiscountDecision {
  validateRule(rule);
  assertNonNegativeFinite(context.subtotal, 'subtotal');

  if (!context.orderType) throw new Error('Order type is required');
  for (const item of context.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Invalid discount context quantity');
    assertNonNegativeFinite(item.lineTotal, 'lineTotal');
    if (!item.productId.trim() || !item.categoryId.trim()) throw new Error('Discount context item identity is required');
  }

  if (rule.minSubtotal !== undefined && context.subtotal < rule.minSubtotal) {
    return { ruleId: rule.id, eligible: false, discount: 0, reason: 'MIN_SUBTOTAL_NOT_MET', requiresApproval: Boolean(rule.requiresApproval) };
  }

  if (rule.orderTypes?.length && !rule.orderTypes.includes(context.orderType)) {
    return { ruleId: rule.id, eligible: false, discount: 0, reason: 'ORDER_TYPE_NOT_ELIGIBLE', requiresApproval: Boolean(rule.requiresApproval) };
  }

  if (!hasEligibleItem(rule, context.items)) {
    return { ruleId: rule.id, eligible: false, discount: 0, reason: 'ITEM_NOT_ELIGIBLE', requiresApproval: Boolean(rule.requiresApproval) };
  }

  let discount = rule.kind === 'PERCENT'
    ? context.subtotal * (rule.value / 100)
    : rule.value;
  if (rule.maxDiscount !== undefined) discount = Math.min(discount, rule.maxDiscount);
  discount = roundMoney(Math.min(discount, context.subtotal));

  return {
    ruleId: rule.id,
    eligible: true,
    discount,
    reason: null,
    requiresApproval: Boolean(rule.requiresApproval),
  };
}
