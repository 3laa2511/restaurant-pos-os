import { describe, expect, it, jest } from '@jest/globals';
import { RefundService } from './refund.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';

type AsyncMock = jest.Mock<(...args: any[]) => Promise<unknown>>;

type AuditMock = { recordWithClient: AsyncMock };

function context(...permissions: AuthContext['permissions']): AuthContext {
  return { userId: 'user-1', tenantId: 'tenant-1', branchId: 'branch-1', deviceId: 'device-1', roles: [], permissions };
}

function prismaMock() {
  const tx = {
    payment: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    shift: { findUnique: jest.fn() },
    paymentAdjustment: { findMany: jest.fn(), create: jest.fn() },
    cashDrawer: { findUnique: jest.fn() },
    cashDrawerMovement: { create: jest.fn() },
    order: { update: jest.fn() },
    orderEvent: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    syncOperation: { create: jest.fn() },
  } as any;
  const prisma = {
    syncOperation: { findUnique: jest.fn() as AsyncMock },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  } as any;
  const audit: AuditMock = { recordWithClient: jest.fn() };
  audit.recordWithClient.mockResolvedValue({ id: 'audit-1', riskScore: 70, riskLevel: 'HIGH' });
  const accounting = { postPaymentAdjustment: jest.fn().mockResolvedValue({ id: 'journal-1' }) };
  return { prisma, tx, audit, accounting };
  return { prisma, tx, audit, accounting };
}

const baseInput = {
  paymentId: 'payment-1', shiftId: 'shift-1', amount: 40, reason: 'Customer return',
  idempotencyKey: 'refund-1', deviceId: 'device-1', clientSequence: 10,
};

function setupPayment(tx: any, status: string = 'PAID') {
  tx.payment.findUnique.mockResolvedValue({ id: 'payment-1', orderId: 'order-1', shiftId: 'shift-1', amount: '100.00', status, method: 'CASH', order: { id: 'order-1', branchId: 'branch-1', status: 'CLOSED' } });
  tx.shift.findUnique.mockResolvedValue({ id: 'shift-1', branchId: 'branch-1', deviceId: 'device-1', status: 'OPEN' });
  tx.paymentAdjustment.findMany.mockResolvedValue([]);
  tx.paymentAdjustment.create.mockResolvedValue({ id: 'adjustment-1' });
  tx.cashDrawer.findUnique.mockResolvedValue({ id: 'drawer-1', branchId: 'branch-1', active: true });
  tx.cashDrawerMovement.create.mockResolvedValue({ id: 'movement-1' });
  tx.syncOperation.create.mockResolvedValue({});
}

describe('RefundService', () => {
  it('persists a partial cash refund and records the immutable drawer movement', async () => {
    const { prisma, tx, audit, accounting } = prismaMock();
    setupPayment(tx);
    tx.payment.findMany.mockResolvedValue([{ amount: '100.00', status: 'PARTIALLY_REFUNDED', adjustments: [{ amount: '40.00' }] }]);
    const service = new RefundService(prisma as never, audit as never, accounting as never);
    const result = await service.refundPayment(context(PERMISSIONS.PAYMENT_REFUND), baseInput);
    expect(result.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(result.orderStatus).toBe('CLOSED');
    expect(tx.paymentAdjustment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentId: 'payment-1', amount: '40.00', type: 'REFUND', actorUserId: 'user-1' }) }));
    expect(tx.cashDrawerMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ drawerId: 'drawer-1', type: 'REFUND', direction: 'OUT', amount: '40.00', sourceType: 'PAYMENT_ADJUSTMENT', sourceId: expect.any(String) }) }));
    expect(audit.recordWithClient).toHaveBeenCalled();
  });

  it('fully refunds the last remaining payment and marks the order REFUNDED', async () => {
    const { prisma, tx, audit } = prismaMock();
    setupPayment(tx);
    tx.payment.findMany.mockResolvedValue([{ amount: '100.00', status: 'REFUNDED', adjustments: [{ amount: '100.00' }] }]);
    const service = new RefundService(prisma as never, audit as never);
    const result = await service.refundPayment(context(PERMISSIONS.PAYMENT_REFUND), { ...baseInput, amount: 100, idempotencyKey: 'refund-2' });
    expect(result.paymentStatus).toBe('REFUNDED');
    expect(result.orderStatus).toBe('REFUNDED');
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, data: { status: 'REFUNDED', version: { increment: 1 } } });
  });

  it('requires the dedicated void permission', async () => {
    const { prisma, tx, audit } = prismaMock();
    setupPayment(tx);
    const service = new RefundService(prisma as never, audit as never);
    await expect(service.voidPayment(context(PERMISSIONS.PAYMENT_REFUND), { ...baseInput, amount: 100, idempotencyKey: 'void-permission' })).rejects.toThrow('Forbidden: missing permission payment.void');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a void after a partial refund even when the caller has void permission', async () => {
    const { prisma, tx, audit } = prismaMock();
    setupPayment(tx, 'PARTIALLY_REFUNDED');
    const service = new RefundService(prisma as never, audit as never);
    await expect(service.voidPayment(context(PERMISSIONS.PAYMENT_VOID), { ...baseInput, amount: 100, idempotencyKey: 'void-1' })).rejects.toThrow('cannot be voided');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.paymentAdjustment.create).not.toHaveBeenCalled();
  });
});
