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

export function validateSyncEnvelope(input: SyncEnvelope): void {
  if (!input.id.trim() || !input.deviceId.trim() || !input.branchId.trim()) {
    throw new Error('Sync identity is required');
  }
  if (!input.entityType.trim() || !input.entityId.trim()) {
    throw new Error('Sync entity is required');
  }
  if (!input.idempotencyKey || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
    throw new Error('A valid idempotency key is required');
  }
  if (!Number.isInteger(input.clientSequence) || input.clientSequence < 1) {
    throw new Error('Client sequence must be a positive integer');
  }
  if (Number.isNaN(Date.parse(input.occurredAt))) throw new Error('Invalid occurredAt');
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new Error('Sync payload must be an object');
  }
}
