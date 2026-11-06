export type PaymentMethod = 'CASH' | 'CARD' | 'WALLET' | 'OTHER';
export type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED' | 'VOIDED';

export interface PaymentInput {
  orderId: string;
  shiftId: string;
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
}

export function assertMoney(value: number, field: string, allowZero?: boolean): void;
export function validatePayment(input: PaymentInput): void;
export function calculateCashChange(amountDue: number, amountReceived: number): number;
