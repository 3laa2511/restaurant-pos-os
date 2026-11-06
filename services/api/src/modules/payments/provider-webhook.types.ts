/**
 * Provider-neutral event shape. This is an authenticated, normalized event;
 * never construct one directly from an untrusted HTTP body.
 */
export interface ProviderWebhookEvent {
  readonly providerEventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly providerTransactionId: string | null;
  readonly merchantReference: string | null;
  /** Integer in the currency's minor unit (e.g. piasters), never a float. */
  readonly amountMinor: bigint | null;
  readonly currency: string | null;
  readonly receivingAccountReference: string | null;
}

/** Reject adapter output that cannot be safely correlated or audited. */
export function assertNormalizedProviderWebhookEvent(
  event: ProviderWebhookEvent,
): void {
  if (!event.providerEventId.trim()) {
    throw new Error('Provider event ID is required');
  }
  if (!event.eventType.trim()) {
    throw new Error('Provider event type is required');
  }
  if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) {
    throw new Error('Provider event timestamp must be a valid Date');
  }
  if (event.providerTransactionId !== null && !event.providerTransactionId.trim()) {
    throw new Error('Provider transaction ID must be non-empty when supplied');
  }
  if (event.merchantReference !== null && !event.merchantReference.trim()) {
    throw new Error('Merchant reference must be non-empty when supplied');
  }
  if (event.amountMinor !== null && event.amountMinor <= 0n) {
    throw new Error('Provider amount must be a positive integer in minor units');
  }
  if (event.currency !== null && !/^[A-Z]{3}$/.test(event.currency)) {
    throw new Error('Provider currency must be a three-letter uppercase code');
  }
  if (
    event.receivingAccountReference !== null
    && !event.receivingAccountReference.trim()
  ) {
    throw new Error('Receiving account reference must be non-empty when supplied');
  }
}
