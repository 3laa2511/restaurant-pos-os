import { describe, expect, it } from '@jest/globals';
import type { AuthContext } from '../auth/authorization.types.js';
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

const authContext: AuthContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  branchId: 'BR01',
  deviceId: 'POS01',
  sessionId: 'session-1',
  workspace: 'POS',
  roles: ['CASHIER'],
  permissions: ['order.create'],
};

const accountingMock = { postSale: async () => undefined };

function createPrismaMock() {
  const records = new Map<string, any>();
  const tx = { $executeRaw: async () => 1, branch: { findFirst: async ({ where }: any) => where.id === 'BR01' && where.tenantId === 'tenant-1' && where.active === true ? { id: 'BR01' } : (where.id === 'BR01' && where.tenantId === 'tenant-1' ? { id: 'BR01' } : null), findMany: async ({ where }: any) => where.tenantId === 'tenant-1' && where.active === true ? [{ id: 'BR01' }] : [] }, syncOperation: { findUnique: async ({ where }: any) => records.get(where.idempotencyKey) ?? null, create: async ({ data }: any) => { if (records.has(data.idempotencyKey)) throw new Error('unique violation'); records.set(data.idempotencyKey, data); return data; }, findMany: async () => [...records.values()].filter((record) => record.status === 'RECEIVED') } };
  return {
    branch: {
      findFirst: async ({ where }: any) =>
        where.id === 'BR01' && where.tenantId === 'tenant-1' && where.active === true ? { id: 'BR01' } : null,
      findMany: async ({ where }: any) =>
        where.tenantId === 'tenant-1' && where.active === true ? [{ id: 'BR01' }] : [],
    },
    syncOperation: {
      findUnique: async ({ where }: any) => records.get(where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        if (records.has(data.idempotencyKey)) throw new Error('unique violation');
        records.set(data.idempotencyKey, data);
        return data;
      },
      findMany: async () => [...records.values()].filter((record) => record.status === 'RECEIVED'),
    },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  };
}

describe('SyncService', () => {
  it('rejects legacy CREATE operations and persists a durable rejection', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never, accountingMock as never);

    const result = await service.submit(authContext, envelope);

    expect(result.status).toBe('REJECTED');
    expect(result.operationId).toBeTruthy();
    expect(await service.pending(authContext)).toHaveLength(0);
  });

  it('returns the stored result for an exact idempotent retry of a rejected operation', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never, accountingMock as never);

    const first = await service.submit(authContext, envelope);
    const second = await service.submit(authContext, envelope);

    expect(first.status).toBe('REJECTED');
    expect(second).toEqual(first);
  });

  it('treats equivalent JSON payloads with different object key order as the same retry', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never, accountingMock as never);

    const first = await service.submit(authContext, {
      ...envelope,
      payload: { id: 'order-1', total: 100, metadata: { source: 'POS', version: 1 } },
    });
    const retry = await service.submit(authContext, {
      ...envelope,
      payload: { metadata: { version: 1, source: 'POS' }, total: 100, id: 'order-1' },
    });

    expect(retry).toEqual(first);
  });

  it('preserves array order when comparing idempotent JSON payloads', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never, accountingMock as never);

    const first = await service.submit(authContext, {
      ...envelope,
      payload: { id: 'order-1', items: [{ productId: 'A' }, { productId: 'B' }] },
    });
    const reordered = await service.submit(authContext, {
      ...envelope,
      payload: { id: 'order-1', items: [{ productId: 'B' }, { productId: 'A' }] },
    });

    expect(first.status).toBe('REJECTED');
    expect(reordered).toEqual({
      status: 'CONFLICT',
      operationId: first.operationId,
      reason: 'Idempotency key was reused with a different operation',
    });
  });

  it('returns conflict when an idempotency key is reused with different content', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never, accountingMock as never);

    const first = await service.submit(authContext, envelope);
    const conflict = await service.submit(authContext, { ...envelope, payload: { id: 'order-2', total: 200 } });

    expect(conflict).toEqual({
      status: 'CONFLICT',
      operationId: first.operationId,
      reason: 'Idempotency key was reused with a different operation',
    });
  });

  it('rejects malformed idempotency keys before touching persistence', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never, accountingMock as never);

    await expect(service.submit(authContext, { ...envelope, idempotencyKey: 'short' })).rejects.toThrow(
      'A valid idempotency key is required',
    );
  });

  it('rejects an operation from another branch', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never, accountingMock as never);

    await expect(service.submit(authContext, { ...envelope, branchId: 'BR02' })).rejects.toThrow(
      'Forbidden: branch access denied',
    );
  });

  it('rejects an operation from another device', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never, accountingMock as never);

    await expect(service.submit(authContext, { ...envelope, deviceId: 'POS99' })).rejects.toThrow(
      'Forbidden: device access denied',
    );
  });
  it('rejects offline card checkout until a verified payment processor is configured', async () => {
    const prisma = createPrismaMock();
    const service = new SyncService(prisma as never, accountingMock as never);
    const checkout = {
      ...envelope,
      operation: 'CHECKOUT' as const,
      entityType: 'ORDER',
      payload: {
        id: 'order-card-1',
        orderNumber: 'BR01-001',
        branchId: 'BR01',
        deviceId: 'POS01',
        cashierId: 'user-1',
        type: 'TAKEAWAY',
        status: 'CONFIRMED',
        items: [{ productId: 'product-1', nameAr: 'منتج', nameEn: 'Product', sku: 'P-1', unitPrice: 100, quantity: 1, note: null }],
        subtotal: 100,
        discount: 0,
        tax: 0,
        serviceFee: 0,
        deliveryFee: 0,
        total: 100,
        createdAt: '2026-09-02T08:01:00.000Z',
        payment: { paymentId: 'payment-card-1', orderId: 'order-card-1', shiftId: 'shift-1', method: 'CARD', amount: 100, reference: 'POS:order-card-1' },
      },
      entityId: 'order-card-1',
    };

    await expect(service.submit(authContext, checkout)).rejects.toThrow(
      'Card checkout cannot be synced until a verified payment processor integration is configured',
    );
  });
}
});
