export interface PricingModifier {
  id: string;
  name: string;
  unitPrice: number;
  quantity?: number;
}

export interface PricingItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  modifiers?: PricingModifier[];
  /** Backward-compatible aggregate modifier amount per item. */
  modifierTotal?: number;
}

export type Discount =
  | { kind: 'PERCENT'; value: number }
  | { kind: 'FIXED'; value: number };

export interface PricingRules {
  discount?: Discount;
  taxRatePercent?: number;
  serviceFeeRatePercent?: number;
  serviceFeeFixed?: number;
  deliveryFee?: number;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  serviceFee: number;
  deliveryFee: number;
  total: number;
}

function assertMoney(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a finite non-negative number`);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Deterministic order pricing. All intermediate monetary values are rounded to
 * two decimals, preventing floating-point residue from leaking into totals.
 */
export function calculateOrderPricing(items: readonly PricingItem[], rules: PricingRules = {}): OrderTotals {
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
  subtotal = roundMoney(subtotal);

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

  return {
    subtotal,
    discount,
    taxable,
    tax,
    serviceFee,
    deliveryFee: roundMoney(deliveryFee),
    total: roundMoney(taxable + tax + serviceFee + deliveryFee),
  };
}

/** Backward-compatible pricing entry point. */
export function calculateOrderTotals(
  items: readonly PricingItem[],
  discount = 0,
  deliveryFee = 0,
): OrderTotals {
  return calculateOrderPricing(items, { discount: { kind: 'FIXED', value: discount }, deliveryFee });
}
