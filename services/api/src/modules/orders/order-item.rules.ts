export interface AddOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: string;
  notes?: string | null;
}

export function validateOrderItem(input: AddOrderItemInput): void {
  if (!input.productId.trim()) throw new Error('Product is required');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error('Quantity must be a positive integer');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(input.unitPrice) || Number(input.unitPrice) < 0) {
    throw new Error('Unit price must be a non-negative monetary value');
  }
  if (input.notes && input.notes.length > 500) {
    throw new Error('Item notes are too long');
  }
}

export function calculateLineTotal(unitPrice: string, quantity: number): string {
  validateOrderItem({ productId: 'validated', quantity, unitPrice });
  const cents = Math.round(Number(unitPrice) * 100) * quantity;
  return (cents / 100).toFixed(2);
}
