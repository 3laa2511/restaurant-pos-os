export interface CheckoutOrderIdentity {
  id: string;
  total: number;
  orderNumber: string;
}

export interface CheckoutPaymentIdentity {
  paymentId: string;
  orderId: string;
  shiftId: string;
  method: string;
  amount: number;
  reference?: string | null;
}

export interface StoredCheckoutPayload extends CheckoutOrderIdentity {
  payment?: CheckoutPaymentIdentity;
}

export function assertExistingCheckoutMatches(
  order: CheckoutOrderIdentity,
  existingEntityId: string,
  stored: StoredCheckoutPayload,
  expectedPayment?: CheckoutPaymentIdentity,
): void {
  if (existingEntityId !== order.id || stored.id !== order.id) {
    throw new Error('Checkout idempotency key was reused with a different order');
  }
  if (stored.total !== order.total || stored.orderNumber !== order.orderNumber) {
    throw new Error('Checkout idempotency key was reused with a different order payload');
  }

  // A matching total and order number are not enough: a reused key must not
  // silently accept a different branch, cashier, order type, or item snapshot.
  const payload = order as CheckoutOrderIdentity & Record<string, unknown>;
  const persisted = stored as StoredCheckoutPayload & Record<string, unknown>;
  const identityFields = [
    'branchId', 'deviceId', 'cashierId', 'type', 'status', 'subtotal',
    'discount', 'tax', 'serviceFee', 'deliveryFee', 'createdAt', 'items',
  ];
  for (const field of identityFields) {
    if (field in payload && JSON.stringify(payload[field]) !== JSON.stringify(persisted[field])) {
      throw new Error('Checkout idempotency key was reused with a different order payload');
    }
  }
  if (expectedPayment) {
    const existingPayment = stored.payment;
    if (!existingPayment
      || existingPayment.paymentId !== expectedPayment.paymentId
      || existingPayment.orderId !== expectedPayment.orderId
      || existingPayment.shiftId !== expectedPayment.shiftId
      || existingPayment.method !== expectedPayment.method
      || existingPayment.amount !== expectedPayment.amount
      || (existingPayment.reference ?? null) !== (expectedPayment.reference ?? null)) {
      throw new Error('Checkout idempotency key was reused with different payment details');
    }
  }
}
