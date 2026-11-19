import { describe, expect, it } from '@jest/globals';
import type { AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
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

function createShiftSyncMock(initialShift: any = null) {
  const records = new Map<string, any>();
  const created: Record<string, any[]> = { shifts: [], movements: [], audits: [] };
  let shift = initialShift;
  const tx: any = {
    $executeRaw: async () => 1,
    branch: { findFirst: async ({ where }: any) => where.id === 'BR01' && where.tenantId === 'tenant-1' ? { id: 'BR01' } : null },
    device: { findFirst: async ({ where }: any) => where.id === 'POS01' ? { id: 'POS01', branchId: 'BR01', status: 'ACTIVE', name: 'POS 01' } : null },
    shift: {
      findFirst: async ({ where }: any) => {
        if (where.id) return shift?.id === where.id ? shift : null;
        return shift?.status === 'OPEN' ? shift : null;
      },
      create: async ({ data }: any) => { shift = data; created.shifts.push(data); return data; },
      updateMany: async ({ where, data }: any) => {
        if (shift?.id !== where.id || shift.status !== 'OPEN') return { count: 0 };
        shift = { ...shift, ...data };
        return { count: 1 };
      },
    },
    cashDrawer: { upsert: async () => ({ id: 'drawer-1', branchId: 'BR01' }) },
    cashDrawerMovement: {
      create: async ({ data }: any) => { created.movements.push(data); return data; },
      findMany: async () => [{ amount: '100.00', direction: 'IN' }, { amount: '20.00', direction: 'OUT' }],
    },
    auditLog: { create: async ({ data }: any) => { created.audits.push(data); return data; } },
    syncOperation: {
      findUnique: async ({ where }: any) => records.get(where.idempotencyKey) ?? null,
      create: async ({ data }: any) => { records.set(data.idempotencyKey, data); return data; },
      findMany: async () => [...records.values()].filter((record) => record.status === 'RECEIVED'),
    },
  };
  return {
    prisma: { $transaction: async (callback: (client: any) => Promise<unknown>) => callback(tx) },
    tx,
    created,
    getShift: () => shift,
    records,
  };
}

describe('SyncService', () => {
  it('applies an offline shift-open operation using the device-created shift id', async () => {
    const { prisma, tx, created, records } = createShiftSyncMock();
    const service = new SyncService(prisma as never, accountingMock as never);
    const shiftEnvelope = {
      ...envelope,
      id: 'device-shift-open-1',
      operation: 'SHIFT' as const,
      entityType: 'SHIFT',
      entityId: 'shift-1',
      idempotencyKey: 'device-1:shift-open:shift-1',
      payload: { action: 'OPEN', shiftId: 'shift-1', openingCash: 100, createdAt: envelope.occurredAt },
    };
    const result = await service.submit({ ...authContext, permissions: [PERMISSIONS.SHIFT_OPEN] }, shiftEnvelope);
    expect(result.status).toBe('APPLIED');
    expect(tx.shift.create).toBeDefined();
    expect(created.shifts[0]).toMatchObject({ id: 'shift-1', branchId: 'BR01', userId: 'user-1', deviceId: 'POS01', openingCash: '100.00', status: 'OPEN' });
    expect(created.movements[0]).toMatchObject({ shiftId: 'shift-1', type: 'OPENING_FLOAT', amount: '100.00' });
    expect(created.audits[0].action).toBe('SHIFT_OPENED');
    expect(records.get(shiftEnvelope.idempotencyKey)?.status).toBe('APPLIED');
  });

  it('applies an offline shift-close operation and records server-calculated variance', async () => {
    const initialShift = { id: 'shift-1', branchId: 'BR01', userId: 'user-1', deviceId: 'POS01', status: 'OPEN', openingCash: '100.00' };
    const { prisma, created, getShift } = createShiftSyncMock(initialShift);
    const service = new SyncService(prisma as never, accountingMock as never);
    const shiftEnvelope = {
      ...envelope,
      id: 'device-shift-close-1',
      operation: 'SHIFT' as const,
      entityType: 'SHIFT',
      entityId: 'shift-1',
      idempotencyKey: 'device-1:shift-close:shift-1',
      clientSequence: 2,
      payload: { action: 'CLOSE', shiftId: 'shift-1', closingCash: 90, createdAt: envelope.occurredAt },
    };
    const result = await service.submit({ ...authContext, permissions: [PERMISSIONS.SHIFT_CLOSE] }, shiftEnvelope);
    expect(result.status).toBe('APPLIED');
    expect(getShift()).toMatchObject({ status: 'CLOSED', closingCash: '90.00', closedAt: new Date(envelope.occurredAt) });
    expect(created.audits.map((audit) => audit.action)).toEqual(['SHIFT_CLOSED', 'SHIFT_VARIANCE']);
    expect(created.audits[0].metadata).toMatchObject({ expectedCash: 80, actualCash: 90, variance: 10 });
  });

  it('requires the matching shift permission for offline lifecycle operations', async () => {
    const { prisma } = createShiftSyncMock();
    const service = new SyncService(prisma as never, accountingMock as never);
    const shiftEnvelope = {
      ...envelope,
      operation: 'SHIFT' as const,
      entityType: 'SHIFT',
      entityId: 'shift-1',
      payload: { action: 'OPEN', shiftId: 'shift-1', openingCash: 100, createdAt: envelope.occurredAt },
    };
    await expect(service.submit(authContext, shiftEnvelope)).rejects.toThrow('permission');
  });

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
});
