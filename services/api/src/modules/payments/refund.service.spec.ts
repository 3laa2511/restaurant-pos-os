import { describe, expect, it, jest } from '@jest/globals';
import { RefundService } from './refund.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';

type AsyncMock = jest.Mock<() => Promise<unknown>>;

function context(): AuthContext {
  return { userId: 'user-1', branchId: 'branch-1', deviceId: 'device-1', roles: [], permissions: [PERMISSIONS.PAYMENT_REFUND] };
}

function prismaMock() {
  const tx = {
    payment: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    shift: { findUnique: jest.fn() },
    paymentAdjustment: { findMany: jest.fn(), create: jest.fn() },
    order: { update: jest.fn() },
    orderEvent: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    syncOperation: { create: jest.fn() },
  } as {
    payment: { findUnique: AsyncMock; update: AsyncMock; findMany: AsyncMock };
    shift: { findUnique: AsyncMock };
    paymentAdjustment: { findMany: AsyncMock; create: AsyncMock };
    order: { update: AsyncMock };
    orderEvent: { create: AsyncMock };
    auditLog: { create: AsyncMock };
    syncOperation: { create: AsyncMock };
  };
  const prisma = {
    syncOperation: { findUnique: jest.fn() as AsyncMock },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { prisma, tx };
}

const baseInput = {
  paymentId: 'payment-1', shiftId: 'shift-1', amount: 40, reason: 'Customer return',
  idempotencyKey: 'refund-1', deviceId: 'device-1', clientSequence: 10,
};

describe('RefundService', () => {
  it('persists a partial refund as an immutable adjustment and updates payment status', async () => {
    const { prisma, tx } = prismaMock();
    tx.payment.findUnique.mockResolvedValue({ id: 'payment-1', orderId: 'order-1', shiftId: 'shift-1', amount: '100.00', status: 'PAID', order: { id: 'order-1', branchId: 'branch-1', status: 'CLOSED' } });
    tx.shift.findUnique.mockResolvedValue({ id: 'shift-1', branchId: 'branch-1', status: 'OPEN' });
    tx.paymentAdjustment.findMany.mockResolvedValue([]);
    tx.paymentAdjustment.create.mockResolvedValue({ id: 'adjustment-1' });
    tx.payment.findMany.mockResolvedValue([{ amount: '100.00', status: 'PARTIALLY_REFUNDED', adjustments: [{ amount: '40.00' }] }]);
    tx.syncOperation.create.mockResolvedValue({});
    const service = new RefundService(prisma as never);
    const result = await service.refundPayment(context(), baseInput);
    expect(result.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(result.orderStatus).toBe('CLOSED');
    expect(tx.paymentAdjustment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentId: 'payment-1', amount: '40.00', type: 'REFUND', actorUserId: 'user-1' }) }));
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { id: 'payment-1' }, data: { status: 'PARTIALLY_REFUNDED' } });
  });

  it('fully refunds the last remaining payment and marks the order REFUNDED', async () => {
    const { prisma, tx } = prismaMock();
    tx.payment.findUnique.mockResolvedValue({ id: 'payment-1', orderId: 'order-1', shiftId: 'shift-1', amount: '100.00', status: 'PAID', order: { id: 'order-1', branchId: 'branch-1', status: 'CLOSED' } });
    tx.shift.findUnique.mockResolvedValue({ id: 'shift-1', branchId: 'branch-1', status: 'OPEN' });
    tx.paymentAdjustment.findMany.mockResolvedValue([]);
    tx.paymentAdjustment.create.mockResolvedValue({ id: 'adjustment-1' });
    tx.payment.findMany.mockResolvedValue([{ amount: '100.00', status: 'REFUNDED', adjustments: [{ amount: '100.00' }] }]);
    tx.syncOperation.create.mockResolvedValue({});
    const service = new RefundService(prisma as never);
    const result = await service.refundPayment(context(), { ...baseInput, amount: 100, idempotencyKey: 'refund-2' });
    expect(result.paymentStatus).toBe('REFUNDED');
    expect(result.orderStatus).toBe('REFUNDED');
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, data: { status: 'REFUNDED', version: { increment: 1 } } });
  });

  it('rejects a void after a partial refund', async () => {
    const { prisma, tx } = prismaMock();
    tx.payment.findUnique.mockResolvedValue({ id: 'payment-1', orderId: 'order-1', shiftId: 'shift-1', amount: '100.00', status: 'PARTIALLY_REFUNDED', order: { id: 'order-1', branchId: 'branch-1', status: 'CLOSED' } });
    tx.shift.findUnique.mockResolvedValue({ id: 'shift-1', branchId: 'branch-1', status: 'OPEN' });
    const service = new RefundService(prisma as never);
    await expect(service.voidPayment(context(), { ...baseInput, amount: 100, idempotencyKey: 'void-1' })).rejects.toThrow('cannot be voided');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.paymentAdjustment.create).not.toHaveBeenCalled();
  });
});
