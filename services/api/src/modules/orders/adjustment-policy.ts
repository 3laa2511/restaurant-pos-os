export type AdjustmentType = 'DISCOUNT' | 'VOID_ITEM' | 'CANCEL_ORDER' | 'REFUND';

export interface AdjustmentRequest {
  type: AdjustmentType;
  orderId: string;
  actorId: string;
  reason: string;
  amount?: number;
  permission: string;
}

const requiredPermissions: Record<AdjustmentType, string> = {
  DISCOUNT: 'order.discount',
  VOID_ITEM: 'order.void_item',
  CANCEL_ORDER: 'order.cancel',
  REFUND: 'payment.refund',
};

export function validateAdjustment(request: AdjustmentRequest): void {
  if (!request.orderId.trim() || !request.actorId.trim()) throw new Error('Order and actor are required');
  if (!request.reason.trim() || request.reason.trim().length < 3) throw new Error('A reason is required');
  if (request.permission !== requiredPermissions[request.type]) {
    throw new Error(`Insufficient permission for ${request.type}`);
  }
  if (request.amount !== undefined && (!Number.isFinite(request.amount) || request.amount <= 0)) {
    throw new Error('Adjustment amount must be positive');
  }
}

export function canAdjustIssuedOrder(status: string, type: AdjustmentType): boolean {
  if (status === 'PAID') return type === 'REFUND';
  if (status === 'CONFIRMED' || status === 'SENT_TO_KITCHEN') {
    return type === 'VOID_ITEM' || type === 'CANCEL_ORDER' || type === 'DISCOUNT';
  }
  return type === 'DISCOUNT' || type === 'CANCEL_ORDER';
}
