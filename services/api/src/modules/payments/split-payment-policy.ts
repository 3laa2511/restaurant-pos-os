import type { PaymentMethod } from './payment-policy.js';

export interface PaymentAllocation {
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
  receivedCash?: number;
}

export interface SplitPaymentInput {
  orderId: string;
  shiftId: string;
  totalDue: number;
  allocations: readonly PaymentAllocation[];
}

export interface SplitPaymentResult {
  totalAllocated: number;
  remaining: number;
  cashReceived: number;
  change: number;
}

const MAX_ALLOCATIONS = 10;

function assertMoney(value: number, field: string, allowZero = false): void {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${field} must be ${allowZero ? 'non-negative' : 'positive'}`);
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

export function validateSplitPayment(input: SplitPaymentInput): SplitPaymentResult {
  if (!input.orderId.trim() || !input.shiftId.trim()) throw new Error('Order and shift are required');
  assertMoney(input.totalDue, 'totalDue');
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    throw new Error('At least one payment allocation is required');
  }
  if (input.allocations.length > MAX_ALLOCATIONS) {
    throw new Error(`A maximum of ${MAX_ALLOCATIONS} payment allocations is allowed`);
  }

  let totalAllocatedCents = 0;
  let cashReceivedCents = 0;
  let cashDueCents = 0;

  for (const allocation of input.allocations) {
    assertMoney(allocation.amount, 'Payment allocation amount');
    const amountCents = cents(allocation.amount);
    totalAllocatedCents += amountCents;

    if (allocation.method !== 'CASH' && !allocation.reference?.trim()) {
      throw new Error('A reference is required for non-cash payments');
    }

    if (allocation.method === 'CASH') {
      cashDueCents += amountCents;
      if (allocation.receivedCash !== undefined) {
        assertMoney(allocation.receivedCash, 'receivedCash');
        if (cents(allocation.receivedCash) < amountCents) {
          throw new Error('Insufficient cash received for cash allocation');
        }
        cashReceivedCents += cents(allocation.receivedCash);
      } else {
        cashReceivedCents += amountCents;
      }
    } else if (allocation.receivedCash !== undefined) {
      throw new Error('receivedCash is only valid for cash allocations');
    }
  }

  const dueCents = cents(input.totalDue);
  if (totalAllocatedCents !== dueCents) {
    if (totalAllocatedCents < dueCents) throw new Error('Payment allocations do not cover the order total');
    throw new Error('Payment allocations exceed the order total');
  }

  const changeCents = Math.max(0, cashReceivedCents - cashDueCents);
  return {
    totalAllocated: roundMoney(totalAllocatedCents / 100),
    remaining: roundMoney((dueCents - totalAllocatedCents) / 100),
    cashReceived: roundMoney(cashReceivedCents / 100),
    change: roundMoney(changeCents / 100),
  };
}

export function calculateSplitPaymentChange(input: SplitPaymentInput): number {
  return validateSplitPayment(input).change;
}
