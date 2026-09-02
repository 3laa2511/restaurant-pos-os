import { describe, expect, it } from '@jest/globals';
import { SyncService } from './sync.service.js';

const envelope = {
  id: 'device-event-1',
  deviceId: 'POS01',
  branchId: 'BR01',
  operation: 'CREATE' as const,
  entityType: 'ORDER',
  entityId: 'order-1',
  idempotencyKey: '0123456789abcdef',
  clientSequence: 1,
  occurredAt: '2026-09-02T08:01:00.000Z',
  payload: { id: 'order-1', total: 100 },
};

function createPrismaMock() {
  const records = new Map<string, any>();
  return {
    syncOperation: {
      findUnique: async ({ where }: any) => records.get(where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        if (records.has(data.idempotencyKey)) throw new Error('unique violation');
        records.set(data.idempotencyKey, data);
        return data;
      },
      findMany: async () => [...records.values()].filter((record) => record.status === 'RECEIVED'),
    },
  };
}

describe('SyncService', () => {
  it('accepts the first operation and persists a durable receipt', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never);

    const result = await service.submit(envelope);

    expect(result.status).toBe('ACCEPTED');
    expect(result.operationId).toBeTruthy();
    expect(await service.pending()).toHaveLength(1);
  });

  it('returns duplicate for the exact same idempotent request', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never);

    const first = await service.submit(envelope);
    const second = await service.submit(envelope);

    expect(first.status).toBe('ACCEPTED');
    expect(second).toEqual({ status: 'ACCEPTED', operationId: first.operationId });
  });

  it('returns conflict when an idempotency key is reused with different content', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never);

    const first = await service.submit(envelope);
    const conflict = await service.submit({ ...envelope, payload: { id: 'order-2', total: 200 } });

    expect(conflict).toEqual({
      status: 'CONFLICT',
      operationId: first.operationId,
      reason: 'Idempotency key was reused with a different operation',
    });
  });

  it('rejects malformed idempotency keys before touching persistence', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never);

    await expect(service.submit({ ...envelope, idempotencyKey: 'short' })).rejects.toThrow(
      'A valid idempotency key is required',
    );
  });
});
