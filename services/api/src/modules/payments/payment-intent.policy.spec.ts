import { describe, expect, it } from '@jest/globals';
import { transitionPaymentIntent, type PaymentVerification } from './payment-intent.policy.js';

const validVerification: PaymentVerification = {
  signatureValid: true,
  transactionId: 'provider-tx-001',
  currency: 'EGP',
  expectedCurrency: 'EGP',
  amountMinor: 12500,
  expectedAmountMinor: 12500,
  receivingAccountMatches: true,
};

describe('payment intent state policy', () => {
  it('moves a newly created intent to pending after submission', () => {
    expect(transitionPaymentIntent('CREATED', 'SUBMITTED')).toBe('PENDING');
  });

  it('does not allow success without verified provider evidence', () => {
    expect(() => transitionPaymentIntent('PENDING', 'PROVIDER_SUCCEEDED')).toThrow('Verified provider transaction is required');
  });

  it('requires a valid signature, exact amount, currency, transaction and receiving account', () => {
    expect(transitionPaymentIntent('PENDING', 'PROVIDER_SUCCEEDED', validVerification)).toBe('SUCCEEDED');
    expect(() => transitionPaymentIntent('PENDING', 'PROVIDER_SUCCEEDED', { ...validVerification, signatureValid: false })).toThrow('Provider signature is invalid');
    expect(() => transitionPaymentIntent('PENDING', 'PROVIDER_SUCCEEDED', { ...validVerification, amountMinor: 12499 })).toThrow('Payment amount does not match intent');
    expect(() => transitionPaymentIntent('PENDING', 'PROVIDER_SUCCEEDED', { ...validVerification, currency: 'USD' })).toThrow('Payment currency does not match intent');
    expect(() => transitionPaymentIntent('PENDING', 'PROVIDER_SUCCEEDED', { ...validVerification, receivingAccountMatches: false })).toThrow('Receiving account does not match payment intent');
    expect(() => transitionPaymentIntent('PENDING', 'PROVIDER_SUCCEEDED', { ...validVerification, transactionId: ' ' })).toThrow('Provider transaction ID is required');
  });

  it('moves ambiguous reconciliation to review without treating it as paid', () => {
    expect(transitionPaymentIntent('PENDING', 'RECONCILIATION_AMBIGUOUS')).toBe('REVIEW_REQUIRED');
  });

  it('does not permit terminal states to be paid again', () => {
    expect(() => transitionPaymentIntent('SUCCEEDED', 'PROVIDER_SUCCEEDED', validVerification)).toThrow('Invalid payment intent transition');
    expect(() => transitionPaymentIntent('FAILED', 'PROVIDER_SUCCEEDED', validVerification)).toThrow('Invalid payment intent transition');
  });

  it('allows an explicitly reviewed ambiguous item to resolve from verified provider evidence', () => {
    expect(transitionPaymentIntent('REVIEW_REQUIRED', 'PROVIDER_SUCCEEDED', validVerification)).toBe('SUCCEEDED');
  });
});
