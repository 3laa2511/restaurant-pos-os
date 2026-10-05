import { describe, expect, jest, test } from '@jest/globals';
import { PrismaOrderRepository } from './prisma-order-repository.js';

const context = {
  userId: 'user-1', tenantId: 'tenant-1', branchId: 'branch-1', deviceId: 'device-1',
  sessionId: 'session-1', workspace: 'POS', roles: [], permissions: ['order.create'],
} as never;

function prismaFake(cycleId: string | null) {
  const executeRaw = jest.fn(async () => 1);
  const orderCreate = jest.fn(async ({ data }: any) => ({
    ...data, version: 1, total: { toString: () => String(data.total) }, branch: { tenantId: 'tenant-1' },
  }));
  const tx = {
    $executeRaw: executeRaw,
    branch: { findFirst: jest.fn(async () => ({ id: 'branch-1', tenantId: 'tenant-1' })) },
    businessCycle: { findFirst: jest.fn(async () => cycleId ? { id: cycleId } : null) },
    order: { create: orderCreate },
  };
  return { prisma: { $transaction: jest.fn(async (fn: any) => fn(tx)) } as any, orderCreate };
}

describe('PrismaOrderRepository business-cycle enforcement', () => {
  test('rejects normal order creation when no business cycle is open', async () => {
    const f = prismaFake(null);
    const repo = new PrismaOrderRepository(f.prisma);
    await expect(repo.create({
      id: 'order-1', orderNumber: '1', branchId: 'branch-1', tenantId: 'tenant-1',
      createdById: 'user-1', source: 'POS', type: 'TAKEAWAY', status: 'DRAFT', total: '10.00',
    }, context)).rejects.toThrow('open business cycle');
    expect(f.orderCreate).not.toHaveBeenCalled();
  });

  test('always stamps the currently open cycle on normal order creation', async () => {
    const f = prismaFake('cycle-1');
    const repo = new PrismaOrderRepository(f.prisma);
    await repo.create({
      id: 'order-2', orderNumber: '2', branchId: 'branch-1', tenantId: 'tenant-1',
      createdById: 'user-1', source: 'POS', type: 'TAKEAWAY', status: 'DRAFT', total: '12.50',
    }, context);
    expect(f.orderCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cycleId: 'cycle-1' }),
    }));
  });
});
