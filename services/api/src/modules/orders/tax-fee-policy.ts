export type TaxFeeOrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type ChargeKind = 'FIXED' | 'PERCENT';

export interface TaxRule {
  id: string;
  name: string;
  ratePercent: number;
  orderTypes?: readonly TaxFeeOrderType[];
  exempt?: boolean;
}

export interface ServiceFeeRule {
  id: string;
  name: string;
  kind: ChargeKind;
  value: number;
  orderTypes?: readonly TaxFeeOrderType[];
  maxAmount?: number;
}

export interface TaxFeeContext {
  orderType: TaxFeeOrderType;
  taxableAmount: number;
}

export interface TaxFeeDecision {
  taxRuleId: string | null;
  serviceFeeRuleId: string | null;
  tax: number;
  serviceFee: number;
  taxRatePercent: number;
}

function assertNonNegativeFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validateOrderType(orderType: TaxFeeOrderType): void {
  if (orderType !== 'DINE_IN' && orderType !== 'TAKEAWAY' && orderType !== 'DELIVERY') {
    throw new Error('Unsupported order type');
  }
}

function isEligible(orderTypes: readonly TaxFeeOrderType[] | undefined, orderType: TaxFeeOrderType): boolean {
  return !orderTypes?.length || orderTypes.includes(orderType);
}

function validateTaxRule(rule: TaxRule): void {
  if (!rule.id.trim()) throw new Error('Tax rule id is required');
  if (!rule.name.trim()) throw new Error('Tax rule name is required');
  assertNonNegativeFinite(rule.ratePercent, 'tax rate');
  if (rule.ratePercent > 100) throw new Error('Tax rate cannot exceed 100');
}

function validateServiceFeeRule(rule: ServiceFeeRule): void {
  if (!rule.id.trim()) throw new Error('Service fee rule id is required');
  if (!rule.name.trim()) throw new Error('Service fee rule name is required');
  if (rule.kind !== 'FIXED' && rule.kind !== 'PERCENT') throw new Error('Unsupported service fee kind');
  assertNonNegativeFinite(rule.value, 'service fee value');
  if (rule.kind === 'PERCENT' && rule.value > 100) throw new Error('Service fee percentage cannot exceed 100');
  if (rule.maxAmount !== undefined) assertNonNegativeFinite(rule.maxAmount, 'maxAmount');
}

/**
 * Evaluates server-owned tax and service-fee policies. The cashier supplies
 * only the order context; monetary rates and eligibility remain rule-owned.
 */
export function evaluateTaxFeePolicies(
  context: TaxFeeContext,
  taxRule?: TaxRule,
  serviceFeeRule?: ServiceFeeRule,
): TaxFeeDecision {
  validateOrderType(context.orderType);
  assertNonNegativeFinite(context.taxableAmount, 'taxableAmount');

  let tax = 0;
  let taxRatePercent = 0;
  let taxRuleId: string | null = null;
  if (taxRule) {
    validateTaxRule(taxRule);
    if (isEligible(taxRule.orderTypes, context.orderType) && !taxRule.exempt) {
      taxRatePercent = taxRule.ratePercent;
      tax = roundMoney(context.taxableAmount * taxRule.ratePercent / 100);
      taxRuleId = taxRule.id;
    }
  }

  let serviceFee = 0;
  let serviceFeeRuleId: string | null = null;
  if (serviceFeeRule) {
    validateServiceFeeRule(serviceFeeRule);
    if (isEligible(serviceFeeRule.orderTypes, context.orderType)) {
      serviceFee = serviceFeeRule.kind === 'PERCENT'
        ? context.taxableAmount * serviceFeeRule.value / 100
        : serviceFeeRule.value;
      if (serviceFeeRule.maxAmount !== undefined) serviceFee = Math.min(serviceFee, serviceFeeRule.maxAmount);
      serviceFee = roundMoney(serviceFee);
      serviceFeeRuleId = serviceFeeRule.id;
    }
  }

  return { taxRuleId, serviceFeeRuleId, tax: Math.min(tax, context.taxableAmount), serviceFee, taxRatePercent };
}
