export interface OrderItemInput {
  productId: string;
  nameSnapshot: string;
  skuSnapshot: string;
  unitPrice: number;
  quantity: number;
  note?: string | null;
}

export function validateOrderItem(item: OrderItemInput): void {
  if (!item.productId.trim()) throw new Error('Product is required');
  if (!item.nameSnapshot.trim()) throw new Error('Product name snapshot is required');
  if (!item.skuSnapshot.trim()) throw new Error('Product SKU snapshot is required');
  if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Quantity must be a positive integer');
  if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error('Unit price must be non-negative');
  if (item.note && item.note.length > 500) throw new Error('Item note is too long');
}

export function buildPriceSnapshot(item: OrderItemInput) {
  validateOrderItem(item);
  return {
    productId: item.productId,
    nameSnapshot: item.nameSnapshot,
    skuSnapshot: item.skuSnapshot,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    note: item.note ?? null,
  };
}
