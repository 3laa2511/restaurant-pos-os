export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export function assertIdempotencyKey(key: string): void {
  if (!key || key.length < 16 || key.length > 128) {
    throw new Error('A valid idempotency key is required');
  }
}

export function assertSameRequest(existing: IdempotencyRecord, requestHash: string): void {
  if (existing.requestHash !== requestHash) {
    throw new Error('Idempotency key was reused with a different request');
  }
}
