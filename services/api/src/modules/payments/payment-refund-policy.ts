export type PaymentAdjustmentType = 'REFUND' | 'VOID';

export interface RefundPolicyInput {
  paymentAmount: number;
  alreadyRefunded: number;
  requestedAmount: number;
  type: PaymentAdjustmentType;
  reason: string;
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function assertMoney(value: number, field: string, allowZero = false): void {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${field} must be ${allowZero ? 'non-negative' : 'positive'}`);
  }
  if (Math.abs(value - cents(value) / 100) > 1e-9) {
    throw new Error(`${field} must have at most 2 decimal places`);
  }
}

export function validateRefund(input: RefundPolicyInput): void {
  assertMoney(input.paymentAmount, 'Payment amount');
  assertMoney(input.alreadyRefunded, 'Already refunded', true);
  assertMoney(input.requestedAmount, 'Refund amount');
  if (!input.reason.trim()) throw new Error('Refund reason is required');
  if (cents(input.alreadyRefunded) > cents(input.paymentAmount)) {
    throw new Error('Existing refunds exceed the payment amount');
  }
  const remaining = cents(input.paymentAmount) - cents(input.alreadyRefunded);
  if (cents(input.requestedAmount) > remaining) {
    throw new Error('Refund amount exceeds the remaining refundable amount');
  }
  if (input.type === 'VOID' && cents(input.requestedAmount) !== remaining) {
    throw new Error('A void must reverse the full remaining payment amount');
  }
}

export function paymentStatusAfterAdjustment(
  paymentAmount: number,
  alreadyRefunded: number,
  requestedAmount: number,
  type: PaymentAdjustmentType,
): 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOIDED' {
  const remainingAfter = cents(paymentAmount) - cents(alreadyRefunded) - cents(requestedAmount);
  if (type === 'VOID') return 'VOIDED';
  return remainingAfter === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}
