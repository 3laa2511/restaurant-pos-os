export type PaymentMethod = 'CASH' | 'CARD' | 'WALLET' | 'OTHER';
export type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED' | 'VOIDED';

export interface PaymentInput {
  orderId: string;
  shiftId: string;
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
}

export function validatePayment(input: PaymentInput): void {
  if (!input.orderId.trim() || !input.shiftId.trim()) throw new Error('Order and shift are required');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Payment amount must be positive');
  if (input.method !== 'CASH' && !input.reference?.trim()) {
    throw new Error('A reference is required for non-cash payments');
  }
}

export function calculateCashChange(amountDue: number, amountReceived: number): number {
  if (amountDue < 0 || amountReceived < 0) throw new Error('Amounts cannot be negative');
  if (amountReceived < amountDue) throw new Error('Insufficient cash received');
  return Number((amountReceived - amountDue).toFixed(2));
}
