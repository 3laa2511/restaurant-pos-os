export function assertMoney(value, field, allowZero = false) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${field} must be ${allowZero ? 'non-negative' : 'positive'}`);
  }
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Math.abs(value - rounded) > 1e-9) {
    throw new Error(`${field} must have at most 2 decimal places`);
  }
}

export function validatePayment(input) {
  if (!input.orderId.trim() || !input.shiftId.trim()) {
    throw new Error('Order and shift are required');
  }
  assertMoney(input.amount, 'Payment amount');
  if (input.method !== 'CASH' && !input.reference?.trim()) {
    throw new Error('A reference is required for non-cash payments');
  }
}

export function calculateCashChange(amountDue, amountReceived) {
  assertMoney(amountDue, 'Amount due', true);
  assertMoney(amountReceived, 'Amount received', true);
  if (amountReceived < amountDue) throw new Error('Insufficient cash received');
  return Number((amountReceived - amountDue).toFixed(2));
}
