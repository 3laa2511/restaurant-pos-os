export interface PricingItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  modifierTotal?: number;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
}

export function calculateOrderTotals(
  items: readonly PricingItem[],
  discount = 0,
  deliveryFee = 0,
): OrderTotals {
  if (discount < 0 || deliveryFee < 0) throw new Error('Discount and delivery fee cannot be negative');

  const subtotal = items.reduce((sum, item) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Invalid quantity');
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error('Invalid unit price');
    const modifiers = item.modifierTotal ?? 0;
    if (!Number.isFinite(modifiers) || modifiers < 0) throw new Error('Invalid modifier total');
    return sum + (item.unitPrice + modifiers) * item.quantity;
  }, 0);

  const total = Math.max(0, subtotal - discount + deliveryFee);
  return { subtotal, discount, deliveryFee, total };
}
