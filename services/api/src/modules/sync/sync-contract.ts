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

const OPERATIONS: readonly SyncOperationType[] = ['CREATE', 'UPDATE', 'CANCEL', 'PAYMENT', 'SHIFT', 'CHECKOUT'];
const IDENTIFIER_LIMITS = {
  id: 128,
  deviceId: 128,
  branchId: 128,
  entityType: 64,
  entityId: 128,
  idempotencyKey: 128,
} as const;
const MAX_PAYLOAD_BYTES = 1_000_000;

function requireIdentifier(value: unknown, field: keyof typeof IDENTIFIER_LIMITS): asserts value is string {
  const max = IDENTIFIER_LIMITS[field];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`Invalid sync ${field}`);
  }
}

export function validateSyncEnvelope(input: unknown): asserts input is SyncEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Sync envelope must be an object');
  }

  const value = input as Partial<SyncEnvelope>;
  requireIdentifier(value.id, 'id');
  requireIdentifier(value.deviceId, 'deviceId');
  requireIdentifier(value.branchId, 'branchId');
  requireIdentifier(value.entityType, 'entityType');
  requireIdentifier(value.entityId, 'entityId');
  requireIdentifier(value.idempotencyKey, 'idempotencyKey');

  if (value.idempotencyKey.length < 16) {
    throw new Error('A valid idempotency key is required');
  }
  if (!OPERATIONS.includes(value.operation as SyncOperationType)) {
    throw new Error('Invalid sync operation');
  }
  if (!Number.isSafeInteger(value.clientSequence) || (value.clientSequence as number) < 1) {
    throw new Error('Client sequence must be a positive integer');
  }
  if (typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))) {
    throw new Error('Invalid occurredAt');
  }
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
    throw new Error('Sync payload must be an object');
  }

  let serializedPayload: string;
  try {
    serializedPayload = JSON.stringify(value.payload);
  } catch {
    throw new Error('Sync payload must be JSON serializable');
  }
  if (serializedPayload.length > MAX_PAYLOAD_BYTES) {
    throw new Error('Sync payload is too large');
  }
}
