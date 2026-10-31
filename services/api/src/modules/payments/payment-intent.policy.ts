export type PaymentIntentStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REVIEW_REQUIRED';

export type PaymentIntentEvent =
  | 'SUBMITTED'
  | 'PROVIDER_PROCESSING'
  | 'PROVIDER_SUCCEEDED'
  | 'PROVIDER_FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'RECONCILIATION_AMBIGUOUS';

export interface PaymentVerification {
  signatureValid: boolean;
  transactionId: string;
  currency: string;
  expectedCurrency: string;
  amountMinor: number;
  expectedAmountMinor: number;
  receivingAccountMatches: boolean;
}

const transitions: Record<PaymentIntentStatus, Partial<Record<PaymentIntentEvent, PaymentIntentStatus>>> = {
  CREATED: {
    SUBMITTED: 'PENDING',
    CANCELLED: 'CANCELLED',
    EXPIRED: 'EXPIRED',
  },
  PENDING: {
    PROVIDER_PROCESSING: 'PROCESSING',
    PROVIDER_SUCCEEDED: 'SUCCEEDED',
    PROVIDER_FAILED: 'FAILED',
    EXPIRED: 'EXPIRED',
    CANCELLED: 'CANCELLED',
    RECONCILIATION_AMBIGUOUS: 'REVIEW_REQUIRED',
  },
  PROCESSING: {
    PROVIDER_SUCCEEDED: 'SUCCEEDED',
    PROVIDER_FAILED: 'FAILED',
    EXPIRED: 'EXPIRED',
    RECONCILIATION_AMBIGUOUS: 'REVIEW_REQUIRED',
  },
  SUCCEEDED: {},
  FAILED: {},
  EXPIRED: {},
  CANCELLED: {},
  REVIEW_REQUIRED: {
    PROVIDER_SUCCEEDED: 'SUCCEEDED',
    PROVIDER_FAILED: 'FAILED',
  },
};

export function transitionPaymentIntent(
  current: PaymentIntentStatus,
  event: PaymentIntentEvent,
  verification?: PaymentVerification,
): PaymentIntentStatus {
  const next = transitions[current][event];
  if (!next) throw new Error(`Invalid payment intent transition: ${current} -> ${event}`);

  if (event === 'PROVIDER_SUCCEEDED') {
    if (!verification) throw new Error('Verified provider transaction is required');
    if (!verification.signatureValid) throw new Error('Provider signature is invalid');
    if (!verification.transactionId.trim()) throw new Error('Provider transaction ID is required');
    if (verification.currency !== verification.expectedCurrency) throw new Error('Payment currency does not match intent');
    if (!Number.isSafeInteger(verification.amountMinor) || verification.amountMinor !== verification.expectedAmountMinor) {
      throw new Error('Payment amount does not match intent');
    }
    if (!verification.receivingAccountMatches) throw new Error('Receiving account does not match payment intent');
  }

  return next;
}
