import { evaluateDiscountRule } from './discount-rules.js';
import type { DiscountContext, DiscountRule } from './discount-rules.js';
import { evaluateTaxFeePolicies } from './tax-fee-policy.js';
import type { ServiceFeeRule, TaxFeeContext, TaxRule } from './tax-fee-policy.js';

export interface PricingModifier { id: string; name: string; unitPrice: number; quantity?: number; }
export interface PricingItem { productId: string; quantity: number; unitPrice: number; categoryId?: string; modifiers?: PricingModifier[]; modifierTotal?: number; }
export type Discount = { kind: 'PERCENT'; value: number } | { kind: 'FIXED'; value: number };
export interface PricingRules { discount?: Discount; taxRatePercent?: number; serviceFeeRatePercent?: number; serviceFeeFixed?: number; deliveryFee?: number; }
export interface OrderTotals { subtotal: number; discount: number; taxable: number; tax: number; serviceFee: number; deliveryFee: number; total: number; }
export interface DiscountRulePricingInput { rule: DiscountRule; orderType: DiscountContext['orderType']; categoryIdsByProductId?: Readonly<Record<string, string>>; approvalGranted?: boolean; }
export interface DiscountRulePricingResult { totals: OrderTotals; ruleId: string; discount: number; requiresApproval: boolean; }
export interface PolicyPricingInput { orderType: TaxFeeContext['orderType']; taxRule?: TaxRule; serviceFeeRule?: ServiceFeeRule; discountRule?: DiscountRulePricingInput; discount?: Discount; deliveryFee?: number; }
export interface PolicyPricingResult { totals: OrderTotals; taxRuleId: string | null; serviceFeeRuleId: string | null; discountRuleId: string | null; requiresDiscountApproval: boolean; }

function assertMoney(value: number, field: string): void { if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a finite non-negative number`); }
function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }

function calculateSubtotal(items: readonly PricingItem[]): number {
  let subtotal = 0;
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Invalid quantity');
    assertMoney(item.unitPrice, 'unitPrice');
    let modifierTotal = item.modifierTotal ?? 0;
    assertMoney(modifierTotal, 'modifierTotal');
    for (const modifier of item.modifiers ?? []) {
      const quantity = modifier.quantity ?? 1;
      if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Invalid modifier quantity');
      assertMoney(modifier.unitPrice, 'modifier unitPrice');
      modifierTotal += modifier.unitPrice * quantity;
    }
    subtotal += (item.unitPrice + modifierTotal) * item.quantity;
  }
  return roundMoney(subtotal);
}

export function calculateOrderPricing(items: readonly PricingItem[], rules: PricingRules = {}): OrderTotals {
  const subtotal = calculateSubtotal(items);
  let discount = 0;
  if (rules.discount?.kind === 'PERCENT') {
    assertMoney(rules.discount.value, 'discount percentage');
    if (rules.discount.value > 100) throw new Error('Discount percentage cannot exceed 100');
    discount = subtotal * (rules.discount.value / 100);
  } else if (rules.discount?.kind === 'FIXED') {
    assertMoney(rules.discount.value, 'discount');
    discount = rules.discount.value;
  }
  discount = roundMoney(Math.min(discount, subtotal));
  const taxable = roundMoney(subtotal - discount);
  const taxRate = rules.taxRatePercent ?? 0;
  assertMoney(taxRate, 'taxRatePercent');
  const tax = roundMoney(taxable * (taxRate / 100));
  const serviceRate = rules.serviceFeeRatePercent ?? 0;
  assertMoney(serviceRate, 'serviceFeeRatePercent');
  const serviceFeeFixed = rules.serviceFeeFixed ?? 0;
  assertMoney(serviceFeeFixed, 'serviceFeeFixed');
  const serviceFee = roundMoney(taxable * (serviceRate / 100) + serviceFeeFixed);
  const deliveryFee = rules.deliveryFee ?? 0;
  assertMoney(deliveryFee, 'deliveryFee');
  return { subtotal, discount, taxable, tax, serviceFee, deliveryFee: roundMoney(deliveryFee), total: roundMoney(taxable + tax + serviceFee + deliveryFee) };
}

export function calculateOrderPricingWithDiscountRule(items: readonly PricingItem[], input: DiscountRulePricingInput, rules: Omit<PricingRules, 'discount'> = {}): DiscountRulePricingResult {
  const subtotal = calculateSubtotal(items);
  const contextItems = items.map((item) => ({
    productId: item.productId,
    categoryId: item.categoryId ?? input.categoryIdsByProductId?.[item.productId] ?? '',
    quantity: item.quantity,
    lineTotal: roundMoney((item.unitPrice + (item.modifierTotal ?? 0) + (item.modifiers ?? []).reduce((sum, modifier) => sum + modifier.unitPrice * (modifier.quantity ?? 1), 0)) * item.quantity),
  }));
  const hasCategoryFilter = (input.rule.categoryIds?.length ?? 0) > 0;
  if (hasCategoryFilter && contextItems.some((item) => !item.categoryId)) throw new Error('Category identity is required for discount eligibility evaluation');
  const decision = evaluateDiscountRule(input.rule, { orderType: input.orderType, subtotal, items: contextItems });
  if (!decision.eligible) throw new Error(`Discount rule is not eligible: ${decision.reason}`);
  if (decision.requiresApproval && !input.approvalGranted) throw new Error('Discount approval is required');
  const totals = calculateOrderPricing(items, { ...rules, discount: { kind: 'FIXED', value: decision.discount } });
  return { totals, ruleId: decision.ruleId, discount: decision.discount, requiresApproval: decision.requiresApproval };
}

export function calculateOrderPricingWithPolicies(items: readonly PricingItem[], input: PolicyPricingInput): PolicyPricingResult {
  let baseTotals: OrderTotals;
  let requiresDiscountApproval = false;
  if (input.discountRule) {
    const discounted = calculateOrderPricingWithDiscountRule(items, input.discountRule, { deliveryFee: input.deliveryFee });
    baseTotals = discounted.totals;
    requiresDiscountApproval = discounted.requiresApproval;
  } else {
    baseTotals = calculateOrderPricing(items, { discount: input.discount, deliveryFee: input.deliveryFee });
  }

  const policy = evaluateTaxFeePolicies(
    { orderType: input.orderType, taxableAmount: baseTotals.taxable },
    input.taxRule,
    input.serviceFeeRule,
  );
  const totals: OrderTotals = {
    ...baseTotals,
    tax: policy.tax,
    serviceFee: policy.serviceFee,
    total: roundMoney(baseTotals.taxable + policy.tax + policy.serviceFee + baseTotals.deliveryFee),
  };
  return {
    totals,
    taxRuleId: policy.taxRuleId,
    serviceFeeRuleId: policy.serviceFeeRuleId,
    discountRuleId: input.discountRule?.rule.id ?? null,
    requiresDiscountApproval,
  };
}

export function calculateOrderTotals(items: readonly PricingItem[], discount = 0, deliveryFee = 0): OrderTotals {
  return calculateOrderPricing(items, { discount: { kind: 'FIXED', value: discount }, deliveryFee });
}
