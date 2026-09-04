import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { PaymentService } from './payment.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import type { PrismaService } from '../../database/prisma.service.js';

const context: AuthContext = {
  userId: 'user-1', branchId: 'branch-1', deviceId: 'device-1', roles: [], permissions: [PERMISSIONS.PAYMENT_CREATE],
};
type AsyncMock = jest.Mock<unknown>;

function buildPrisma() {
  const tx = {
    order: { findUnique: jest.fn(), updateMany: jest.fn() },
    shift: { findUnique: jest.fn() },
    payment: { findMany: jest.fn(), create: jest.fn() },
    orderEvent: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    syncOperation: { create: jest.fn() },
  } as {
    order: { findUnique: AsyncMock; updateMany: AsyncMock };
    shift: { findUnique: AsyncMock };
    payment: { findMany: AsyncMock; create: AsyncMock };
    orderEvent: { create: AsyncMock };
    auditLog: { create: AsyncMock };
    syncOperation: { create: AsyncMock };
  };
  tx.order.findUnique.mockResolvedValue({ id: 'order-1', branchId: 'branch-1', status: 'CONFIRMED', total: { toString: () => '250.00' }, version: 3 });
  tx.order.updateMany.mockResolvedValue({ count: 1 });
  tx.shift.findUnique.mockResolvedValue({ id: 'shift-1', branchId: 'branch-1', status: 'OPEN' });
  tx.payment.findMany.mockResolvedValue([]);
  tx.payment.create.mockResolvedValue({});
  tx.orderEvent.create.mockResolvedValue({});
  tx.auditLog.create.mockResolvedValue({});
  tx.syncOperation.create.mockResolvedValue({});

  const prisma = {
    syncOperation: { findUnique: jest.fn() as AsyncMock },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  prisma.syncOperation.findUnique.mockResolvedValue(null);
  return { prisma, tx };
}

describe('PaymentService.settleSplitPayment', () => {
  it('persists mixed payment settlement atomically and closes the order', async () => {
    const { prisma, tx } = buildPrisma();
    const service = new PaymentService(prisma as unknown as PrismaService);
    const result = await service.settleSplitPayment(context, {
      orderId: 'order-1', shiftId: 'shift-1',
      allocations: [{ method: 'CASH', amount: 100, receivedCash: 120 }, { method: 'CARD', amount: 150, reference: 'card-123' }],
      idempotencyKey: 'checkout-1', deviceId: 'device-1', clientSequence: 42,
    });
    expect(result.status).toBe('PAID');
    expect(result.totalPaid).toBe(250);
    expect(result.change).toBe(20);
    expect(result.paymentIds).toHaveLength(2);
    expect(tx.payment.create).toHaveBeenCalledTimes(2);
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { id: 'order-1', version: 3, status: 'CONFIRMED' }, data: { status: 'CLOSED', version: { increment: 1 } } });
    expect(tx.orderEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.syncOperation.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not charge an already-paid order again', async () => {
    const { prisma, tx } = buildPrisma();
    tx.payment.findMany.mockResolvedValue([{ id: 'payment-existing' }]);
    const service = new PaymentService(prisma as unknown as PrismaService);
    await expect(service.settleSplitPayment(context, {
      orderId: 'order-1', shiftId: 'shift-1', allocations: [{ method: 'CASH', amount: 250 }],
      idempotencyKey: 'checkout-2', deviceId: 'device-1', clientSequence: 43,
    })).rejects.toThrow('already has payments');
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.syncOperation.create).not.toHaveBeenCalled();
  });

  it('returns the stored result for an idempotent retry', async () => {
    const { prisma, tx } = buildPrisma();
    const stored = { operationId: 'operation-1', orderId: 'order-1', status: 'PAID', totalPaid: 250, change: 0, paymentIds: ['payment-1'] };
    const input = { orderId: 'order-1', shiftId: 'shift-1', allocations: [{ method: 'CASH' as const, amount: 250 }], idempotencyKey: 'checkout-3', deviceId: 'device-1', clientSequence: 44 };
    const firstHash = createHash('sha256').update(JSON.stringify({ ...input, allocations: input.allocations })).digest('hex');
    prisma.syncOperation.findUnique.mockResolvedValue({ operationId: 'operation-1', requestHash: firstHash, result: stored });
    const service = new PaymentService(prisma as unknown as PrismaService);
    await expect(service.settleSplitPayment(context, input)).resolves.toEqual(stored);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('recovers the winner when two requests race on the same idempotency key', async () => {
    const { prisma, tx } = buildPrisma();
    const stored = { operationId: 'operation-winner', orderId: 'order-1', status: 'PAID', totalPaid: 250, change: 0, paymentIds: ['payment-winner'] };
    const input = { orderId: 'order-1', shiftId: 'shift-1', allocations: [{ method: 'CASH' as const, amount: 250 }], idempotencyKey: 'checkout-race', deviceId: 'device-1', clientSequence: 45 };
    const requestHash = createHash('sha256').update(JSON.stringify({ ...input, allocations: input.allocations })).digest('hex');
    prisma.syncOperation.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ operationId: 'operation-winner', requestHash, result: stored });
    tx.syncOperation.create.mockRejectedValueOnce({ code: 'P2002' });
    const service = new PaymentService(prisma as unknown as PrismaService);
    await expect(service.settleSplitPayment(context, input)).resolves.toEqual(stored);
    expect(prisma.syncOperation.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.syncOperation.create).toHaveBeenCalledTimes(1);
  });
});
