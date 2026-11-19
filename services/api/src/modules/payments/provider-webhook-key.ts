import { createHash, randomBytes } from 'node:crypto';

export interface GeneratedProviderWebhookKey {
  /** Return to the provider/configuration UI once; never persist or log it. */
  plaintext: string;
  /** Persist this SHA-256 digest in PaymentProviderAccount.webhookKeyHash. */
  hash: string;
}

export function generateProviderWebhookKey(): GeneratedProviderWebhookKey {
  const plaintext = randomBytes(32).toString('base64url');
  return { plaintext, hash: hashProviderWebhookKey(plaintext) };
}

export function hashProviderWebhookKey(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length < 32 || plaintext.length > 256) {
    throw new Error('Provider webhook key must be between 32 and 256 characters');
  }

  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}
