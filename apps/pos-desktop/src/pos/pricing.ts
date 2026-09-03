export type DiscountKind = 'FIXED' | 'PERCENT';

export interface PriceAdjustment {
  kind: DiscountKind;
  value: number;
}

export interface PricingInput {
  items: Array<{ unitPrice: number; quantity: number }>;
  discount?: PriceAdjustment | null;
  taxRate?: number;
  serviceFeeRate?: number;
  deliveryFee?: number;
}

export interface PricingBreakdown {
  subtotal: number;
  discount: number;
  taxableSubtotal: number;
  tax: number;
  serviceFee: number;
  deliveryFee: number;
  total: number;
}

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a finite non-negative number`);
}

export function calculatePricing(input: PricingInput): PricingBreakdown {
  if (!Array.isArray(input.items)) throw new Error('Pricing items are required');

  const subtotal = roundMoney(input.items.reduce((sum, item) => {
    assertFiniteNonNegative(item.unitPrice, 'unitPrice');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('quantity must be a positive integer');
    return sum + item.unitPrice * item.quantity;
  }, 0));

  const discountRule = input.discount ?? null;
  let discount = 0;
  if (discountRule) {
    assertFiniteNonNegative(discountRule.value, 'discount value');
    discount = discountRule.kind === 'PERCENT'
      ? subtotal * Math.min(discountRule.value, 100) / 100
      : Math.min(discountRule.value, subtotal);
  }
  discount = roundMoney(discount);

  const taxableSubtotal = roundMoney(Math.max(0, subtotal - discount));
  const taxRate = input.taxRate ?? 0;
  const serviceFeeRate = input.serviceFeeRate ?? 0;
  const deliveryFee = input.deliveryFee ?? 0;
  assertFiniteNonNegative(taxRate, 'taxRate');
  assertFiniteNonNegative(serviceFeeRate, 'serviceFeeRate');
  assertFiniteNonNegative(deliveryFee, 'deliveryFee');

  const tax = roundMoney(taxableSubtotal * taxRate / 100);
  const serviceFee = roundMoney(taxableSubtotal * serviceFeeRate / 100);
  const total = roundMoney(taxableSubtotal + tax + serviceFee + deliveryFee);

  return { subtotal, discount, taxableSubtotal, tax, serviceFee, deliveryFee: roundMoney(deliveryFee), total };
}
