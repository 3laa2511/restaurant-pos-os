import { validateSyncEnvelope } from './sync-contract.js';

describe('sync envelope validation', () => {
  const base = {
    id: 'op-1',
    deviceId: 'device-1',
    branchId: 'branch-1',
    operation: 'CHECKOUT',
    entityType: 'ORDER',
    entityId: 'order-1',
    idempotencyKey: '0123456789abcdef',
    clientSequence: 1,
    occurredAt: new Date().toISOString(),
    payload: { orderId: 'order-1' },
  };

  it('accepts valid envelopes', () => {
    expect(() => validateSyncEnvelope(base)).not.toThrow();
  });

  it('rejects invalid operation and sequence', () => {
    expect(() => validateSyncEnvelope({ ...base, operation: 'DELETE' })).toThrow();
    expect(() => validateSyncEnvelope({ ...base, clientSequence: 0 })).toThrow();
  });

  it('rejects invalid identity and timestamp', () => {
    expect(() => validateSyncEnvelope({ ...base, branchId: ' ' })).toThrow();
    expect(() => validateSyncEnvelope({ ...base, occurredAt: 'invalid' })).toThrow();
  });
});
