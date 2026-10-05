import { describe, expect, it, jest } from '@jest/globals';
import { PrismaOrderRepository } from './prisma-order-repository.js';
import { OrderStatus } from './order-status.js';
import type { AuthContext } from '../auth/authorization.types.js';

jest.mock('../../database/rls-context.js', () => ({
  setRlsContext: jest.fn(async () => undefined),
  withRlsContext: jest.fn(),
}));

const context: AuthContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  deviceId: 'device-1',
  sessionId: 'session-1',
  workspace: 'POS',
  roles: ['CASHIER'],
  permissions: [],
};

function makePrisma(cycle: { id: string } | null) {
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    branch: { findFirst: jest.fn(async () => ({ id: 'branch-1', tenantId: 'tenant-1' })) },
    businessCycle: { findFirst: jest.fn(async () => cycle) },
    order: {
      create: jest.fn(async () => ({
        id: 'order-1',
        orderNumber: 'branch-1-1',
        branchId: 'branch-1',
        createdById: 'user-1',
        source: 'POS',
        type: 'TAKEAWAY',
        status: OrderStatus.DRAFT,
        total: { toString: () => '10.00' },
        version: 1,
        branch: { tenantId: 'tenant-1' },
      })),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: jest.fn(async (callback: any, _options?: any) => callback(tx)),
    },
  };
}

describe('PrismaOrderRepository business cycle guard', () => {
  it('refuses normal order creation when no business cycle is open', async () => {
    const { prisma } = makePrisma(null);
    const repository = new PrismaOrderRepository(prisma as never);

    await expect(repository.create({
      id: 'order-1',
      orderNumber: 'branch-1-1',
      branchId: 'branch-1',
      tenantId: 'tenant-1',
      createdById: 'user-1',
      source: 'POS',
      type: 'TAKEAWAY',
      status: OrderStatus.DRAFT,
      total: '10.00',
    }, context)).rejects.toThrow('An open business cycle is required before creating an order');

    expect((prisma.tx.order.create as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('always attaches a normal order to the currently open cycle', async () => {
    const { prisma } = makePrisma({ id: 'cycle-current' });
    const repository = new PrismaOrderRepository(prisma as never);

    await repository.create({
      id: 'order-1',
      orderNumber: 'branch-1-1',
      branchId: 'branch-1',
      tenantId: 'tenant-1',
      createdById: 'user-1',
      source: 'POS',
      type: 'TAKEAWAY',
      status: OrderStatus.DRAFT,
      total: '10.00',
    }, context);

    expect(prisma.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cycleId: 'cycle-current' }),
    }));
  });
});
