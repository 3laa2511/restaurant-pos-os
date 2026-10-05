import { describe, expect, it, jest } from '@jest/globals';
import { PrismaOrderRepository } from './prisma-order-repository.js';
import { OrderStatus } from './order-status.js';
import type { AuthContext } from '../auth/authorization.types.js';

const context: AuthContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  deviceId: 'device-1',
  sessionId: 'session-1',
  workspace: 'POS',
  roles: ['CASHIER'],
  permissions: ['order.create'],
};

function harness(cycle: any) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    branch: {
      findFirst: jest.fn().mockResolvedValue({ id: 'branch-1', tenantId: 'tenant-1' }),
    },
    businessCycle: {
      findFirst: jest.fn().mockResolvedValue(cycle),
    },
    order: {
      create: jest.fn().mockResolvedValue({
        id: 'order-1',
        orderNumber: 'BR-1',
        branchId: 'branch-1',
        createdById: 'user-1',
        source: 'POS',
        type: 'TAKEAWAY',
        status: 'DRAFT',
        total: 50,
        version: 1,
        branch: { tenantId: 'tenant-1' },
      }),
    },
  };
  const prisma = { $transaction: jest.fn(async (callback: any) => callback(tx)) };
  return { repository: new PrismaOrderRepository(prisma as never), tx };
}

const input = {
  id: 'order-1',
  orderNumber: 'BR-1',
  branchId: 'branch-1',
  tenantId: 'tenant-1',
  createdById: 'user-1',
  source: 'POS',
  type: 'TAKEAWAY',
  status: OrderStatus.DRAFT,
  total: '50.00',
};

describe('PrismaOrderRepository business-cycle enforcement', () => {
  it('refuses normal order creation when no cycle is open', async () => {
    const h = harness(null);
    await expect(h.repository.create(input, context))
      .rejects.toThrow('An open business cycle is required before creating an order');
    expect(h.tx.order.create).not.toHaveBeenCalled();
  });

  it('attaches every normal order to the open cycle', async () => {
    const h = harness({ id: 'cycle-1' });
    await h.repository.create(input, context);
    expect(h.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cycleId: 'cycle-1' }),
    }));
  });
});
