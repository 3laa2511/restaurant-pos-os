import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PaymentService } from './payment.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import type { PrismaService } from '../../database/prisma.service.js';

const context: AuthContext = {
  userId: 'user-1', tenantId: 'tenant-1', branchId: 'branch-1', deviceId: 'device-1', sessionId: 'session-1', workspace: 'POS', roles: [], permissions: [PERMISSIONS.PAYMENT_CREATE],
};
type AsyncMock = jest.Mock<(...args: any[]) => Promise<unknown>>;

function buildPrisma() {
  const tx = {
    $executeRaw: jest.fn<(...args: any[]) => Promise<number>>().mockResolvedValue(1),
    order: { findFirst: jest.fn(), updateMany: jest.fn() },
    shift: { findFirst: jest.fn() },
    payment: { findMany: jest.fn(), create: jest.fn() },
    cashDrawer: { findUnique: jest.fn() },
    cashDrawerMovement: { findMany: jest.fn(), create: jest.fn() },
    orderEvent: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    syncOperation: { findUnique: jest.fn(), create: jest.fn() },
  } as any;
  tx.order.findFirst.mockResolvedValue({ id: 'order-1', branchId: 'branch-1', status: 'CONFIRMED', total: { toString: () => '250.00' }, version: 3 });
  tx.order.updateMany.mockResolvedValue({ count: 1 });
  tx.shift.findFirst.mockResolvedValue({ id: 'shift-1', branchId: 'branch-1', deviceId: 'device-1', status: 'OPEN' });
  tx.payment.findMany.mockResolvedValue([]);
  tx.payment.create.mockResolvedValue({});
  tx.cashDrawer.findUnique.mockResolvedValue({ id: 'drawer-1', branchId: 'branch-1', deviceId: 'device-1', active: true });
  tx.cashDrawerMovement.findMany.mockResolvedValue([{ amount: { toString: () => '1000.00' }, direction: 'IN' }]);
  tx.cashDrawerMovement.create.mockResolvedValue({});
  tx.orderEvent.create.mockResolvedValue({});
  tx.auditLog.create.mockResolvedValue({});
  tx.syncOperation.findUnique.mockResolvedValue(null);
  tx.syncOperation.create.mockResolvedValue({});
  const prisma = { syncOperation: { findUnique: jest.fn() as AsyncMock }, $transaction: jest.fn(async (callback: any) => callback(tx)) };
  prisma.syncOperation.findUnique.mockResolvedValue(null);
  return { prisma, tx };
}

describe('PaymentService.settleSplitPayment', () => {
  it('persists mixed payment settlement atomically and applies the authenticated tenant to order, shift, and transition', async () => {
    const { prisma, tx } = buildPrisma();
    const service = new PaymentService(prisma as unknown as PrismaService, { postSale: jest.fn() } as any);
    const result = await service.settleSplitPayment(context, {
      orderId: 'order-1', shiftId: 'shift-1',
      allocations: [{ method: 'CASH', amount: 100, receivedCash: 120 }, { method: 'CARD', amount: 150, reference: 'card-123' }],
      idempotencyKey: 'checkout-1', deviceId: 'device-1', clientSequence: 42,
    });
    expect(result.status).toBe('PAID');
    expect(result.totalPaid).toBe(250);
    expect(result.change).toBe(20);
    expect(result.paymentIds).toHaveLength(2);
    expect(tx.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'order-1', branch: { tenantId: 'tenant-1' } } }));
    expect(tx.shift.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'shift-1', branch: { tenantId: 'tenant-1' } } }));
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'order-1', version: 3, status: 'CONFIRMED', branch: { tenantId: 'tenant-1' } } }));
    expect(tx.payment.create).toHaveBeenCalledTimes(2);
    expect(tx.cashDrawerMovement.create).toHaveBeenCalledTimes(2);
    expect(tx.orderEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.syncOperation.create).toHaveBeenCalledTimes(1);
  });

  it('cannot settle an order belonging to another tenant', async () => {
    const { prisma, tx } = buildPrisma();
    tx.order.findFirst.mockResolvedValue(null);
    const service = new PaymentService(prisma as unknown as PrismaService, { postSale: jest.fn() } as any);
    await expect(service.settleSplitPayment(context, { orderId: 'foreign-order', shiftId: 'shift-1', allocations: [{ method: 'CASH', amount: 250 }], idempotencyKey: 'checkout-cross-tenant', deviceId: 'device-1', clientSequence: 46 })).rejects.toThrow('Order not found');
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('denies settlement when the authenticated session has no tenant scope', async () => {
    const { prisma } = buildPrisma();
    const service = new PaymentService(prisma as unknown as PrismaService, { postSale: jest.fn() } as any);
    await expect(service.settleSplitPayment({ ...context, tenantId: null }, { orderId: 'order-1', shiftId: 'shift-1', allocations: [{ method: 'CASH', amount: 250 }], idempotencyKey: 'checkout-no-tenant', deviceId: 'device-1', clientSequence: 47 })).rejects.toThrow('tenant scope is required');
    expect(prisma.syncOperation.findUnique).not.toHaveBeenCalled();
  });

  it('does not charge an already-paid order again', async () => {
    const { prisma, tx } = buildPrisma();
    tx.payment.findMany.mockResolvedValue([{ id: 'payment-existing' }]);
    const service = new PaymentService(prisma as unknown as PrismaService, { postSale: jest.fn() } as any);
    await expect(service.settleSplitPayment(context, { orderId: 'order-1', shiftId: 'shift-1', allocations: [{ method: 'CASH', amount: 250 }], idempotencyKey: 'checkout-2', deviceId: 'device-1', clientSequence: 43 })).rejects.toThrow('already has payments');
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('returns the stored result for an idempotent retry', async () => {
    const { prisma, tx } = buildPrisma();
    const stored = { operationId: 'operation-1', orderId: 'order-1', status: 'PAID', totalPaid: 250, change: 0, paymentIds: ['payment-1'] };
    const input = { orderId: 'order-1', shiftId: 'shift-1', allocations: [{ method: 'CASH' as const, amount: 250 }], idempotencyKey: 'checkout-3', deviceId: 'device-1', clientSequence: 44 };
    const hash = createHash('sha256').update(JSON.stringify({ ...input, allocations: input.allocations })).digest('hex');
    prisma.syncOperation.findUnique.mockResolvedValue({ operationId: 'operation-1', requestHash: hash, result: stored });
    const service = new PaymentService(prisma as unknown as PrismaService, { postSale: jest.fn() } as any);
    await expect(service.settleSplitPayment(context, input)).resolves.toEqual(stored);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('recovers the winner when two requests race on the same idempotency key', async () => {
    const { prisma, tx } = buildPrisma();
    const stored = { operationId: 'operation-winner', orderId: 'order-1', status: 'PAID', totalPaid: 250, change: 0, paymentIds: ['payment-winner'] };
    const input = { orderId: 'order-1', shiftId: 'shift-1', allocations: [{ method: 'CASH' as const, amount: 250 }], idempotencyKey: 'checkout-race', deviceId: 'device-1', clientSequence: 45 };
    const hash = createHash('sha256').update(JSON.stringify({ ...input, allocations: input.allocations })).digest('hex');
    const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.10.0' });
    prisma.syncOperation.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ operationId: 'operation-winner', requestHash: hash, result: stored });
    tx.syncOperation.create.mockRejectedValueOnce(uniqueError);
    const service = new PaymentService(prisma as unknown as PrismaService, { postSale: jest.fn() } as any);
    await expect(service.settleSplitPayment(context, input)).resolves.toEqual(stored);
    expect(prisma.syncOperation.findUnique).toHaveBeenCalledTimes(2);
  });
});
