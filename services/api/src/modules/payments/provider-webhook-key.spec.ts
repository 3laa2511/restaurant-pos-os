import { describe, expect, it } from '@jest/globals';
import { generateProviderWebhookKey, hashProviderWebhookKey } from './provider-webhook-key.js';

describe('provider webhook endpoint keys', () => {
  it('generates a high-entropy opaque key and stores only its digest', () => {
    const generated = generateProviderWebhookKey();

    expect(generated.plaintext).toHaveLength(43);
    expect(generated.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.hash).toBe(hashProviderWebhookKey(generated.plaintext));
    expect(generated.hash).not.toBe(generated.plaintext);
  });

  it('generates different keys for separate provider accounts', () => {
    const first = generateProviderWebhookKey();
    const second = generateProviderWebhookKey();

    expect(second.plaintext).not.toBe(first.plaintext);
    expect(second.hash).not.toBe(first.hash);
  });

  it('rejects short or excessively long endpoint keys', () => {
    expect(() => hashProviderWebhookKey('short')).toThrow('between 32 and 256 characters');
    expect(() => hashProviderWebhookKey('x'.repeat(257))).toThrow('between 32 and 256 characters');
  });
});
