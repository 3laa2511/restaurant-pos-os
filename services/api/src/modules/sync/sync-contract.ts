export type SyncOperationType = 'CREATE' | 'UPDATE' | 'CANCEL' | 'PAYMENT' | 'SHIFT' | 'CHECKOUT';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface SyncEnvelope {
  id: string;
  deviceId: string;
  branchId: string;
  operation: SyncOperationType;
  entityType: string;
  entityId: string;
  idempotencyKey: string;
  clientSequence: number;
  occurredAt: string;
  payload: JsonObject;
}

export type SyncResult =
  | { status: 'ACCEPTED'; operationId: string }
  | { status: 'APPLIED'; operationId: string }
  | { status: 'DUPLICATE'; operationId: string }
  | { status: 'CONFLICT'; operationId: string; reason: string }
  | { status: 'REJECTED'; operationId: string; reason: string };

export function validateSyncEnvelope(input: unknown): asserts input is SyncEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Sync envelope must be an object');
  }
  const value = input as Partial<SyncEnvelope>;
  const operations: SyncOperationType[] = ['CREATE', 'UPDATE', 'CANCEL', 'PAYMENT', 'SHIFT', 'CHECKOUT'];
  for (const [field, max] of [['id', 128], ['deviceId', 128], ['branchId', 128], ['entityType', 64], ['entityId', 128], ['idempotencyKey', 128]] as const) {
    const raw = value[field];
    if (typeof raw !== 'string' || !raw.trim() || raw.length > max) throw new Error(`Invalid sync ${field}`);
  }
  if (!operations.includes(value.operation as SyncOperationType)) throw new Error('Invalid sync operation');
  if (!Number.isInteger(value.clientSequence) || (value.clientSequence as number) < 1) {
    throw new Error('Client sequence must be a positive integer');
  }
  if (typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))) throw new Error('Invalid occurredAt');
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) throw new Error('Sync payload must be an object');

  const input = value as SyncEnvelope;
  if (!input.id.trim() || !input.deviceId.trim() || !input.branchId.trim()) {
    throw new Error('Sync identity is required');
  }
  if (!input.idempotencyKey || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
    throw new Error('A valid idempotency key is required');
  }
  if (input.payload && JSON.stringify(input.payload).length > 1_000_000) throw new Error('Sync payload is too large');

}
