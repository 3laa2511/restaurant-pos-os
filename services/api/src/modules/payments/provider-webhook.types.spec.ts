import { describe, expect, it } from '@jest/globals';
import { assertNormalizedProviderWebhookEvent } from './provider-webhook.types.js';

const validEvent = {
  providerEventId: 'evt_123',
  eventType: 'payment.succeeded',
  occurredAt: new Date('2026-11-06T04:00:00.000Z'),
  providerTransactionId: 'txn_123',
  merchantReference: 'order-ref-123',
  amountMinor: 1500n,
  currency: 'EGP',
  receivingAccountReference: 'merchant-account-1',
} as const;

describe('assertNormalizedProviderWebhookEvent', () => {
  it('accepts a fully normalized event using integer minor units', () => {
    expect(() => assertNormalizedProviderWebhookEvent(validEvent)).not.toThrow();
  });

  it.each([
    [{ ...validEvent, providerEventId: ' ' }, 'Provider event ID'],
    [{ ...validEvent, eventType: '' }, 'Provider event type'],
    [{ ...validEvent, occurredAt: new Date('invalid') }, 'timestamp'],
    [{ ...validEvent, providerTransactionId: ' ' }, 'transaction ID'],
    [{ ...validEvent, amountMinor: 0n }, 'positive integer'],
    [{ ...validEvent, amountMinor: -1n }, 'positive integer'],
    [{ ...validEvent, currency: 'egp' }, 'currency'],
    [{ ...validEvent, receivingAccountReference: ' ' }, 'Receiving account'],
  ])('rejects malformed adapter output', (event, message) => {
    expect(() => assertNormalizedProviderWebhookEvent(event)).toThrow(message);
  });

  it('allows nullable correlation fields for events that need manual review', () => {
    expect(() => assertNormalizedProviderWebhookEvent({
      ...validEvent,
      providerTransactionId: null,
      merchantReference: null,
      amountMinor: null,
      currency: null,
      receivingAccountReference: null,
    })).not.toThrow();
  });
});
