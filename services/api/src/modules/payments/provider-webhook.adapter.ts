import type { ProviderWebhookEvent } from './provider-webhook.types.js';

/**
 * The HTTP layer must capture the exact request bytes before JSON parsing.
 * Adapters must verify signatures against rawBody, never re-serialized JSON.
 */
export interface ProviderWebhookRequest {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly receivedAt: Date;
}

export interface ProviderWebhookCredentials {
  /** Provider-specific secrets are loaded from a secret manager by the caller. */
  readonly values: Readonly<Record<string, string>>;
}

export type ProviderWebhookVerificationResult =
  | { readonly verified: true; readonly event: ProviderWebhookEvent }
  | {
      readonly verified: false;
      readonly reason:
        | 'MISSING_SIGNATURE'
        | 'INVALID_SIGNATURE'
        | 'MALFORMED_PAYLOAD'
        | 'UNSUPPORTED_EVENT'
        | 'STALE_EVENT';
    };

/**
 * Provider adapters own signature verification and provider-specific parsing.
 * A successful result is the only path to a normalized event.
 */
export interface ProviderWebhookAdapter {
  readonly providerCode: string;
  verifyAndNormalize(
    request: ProviderWebhookRequest,
    credentials: ProviderWebhookCredentials,
  ): Promise<ProviderWebhookVerificationResult>;
}
