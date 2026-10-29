import type { Order } from './order.js';
import type { PaymentInput, PaymentMethod } from '@restaurant-pos/payment-policy';
import { calculateCashChange, validatePayment } from '@restaurant-pos/payment-policy';

export interface CheckoutRequest {
  order: Order;
  shiftId: string;
  method: PaymentMethod;
  receivedCash?: number;
  reference?: string;
}

export interface CheckoutResult {
  payment: PaymentInput;
  change: number;
}

export function checkoutOrder(input: CheckoutRequest): CheckoutResult {
  if (input.order.status !== 'CONFIRMED') throw new Error(`Order must be confirmed before payment: ${input.order.status}`);
  const amount = input.order.total;
  const change = input.method === 'CASH' ? calculateCashChange(amount, input.receivedCash ?? 0) : 0;
  const payment: PaymentInput = { orderId: input.order.id, shiftId: input.shiftId, method: input.method, amount, reference: input.reference ?? null };
  validatePayment(payment);
  return { payment, change };
}
