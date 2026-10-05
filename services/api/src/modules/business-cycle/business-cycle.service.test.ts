import { describe, expect, it, jest } from '@jest/globals';
import { BusinessCycleService } from './business-cycle.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';

jest.mock('../../database/rls-context.js', () => ({
  setRlsContext: jest.fn(async () => undefined),
  withRlsContext: async (prisma: any, _context: unknown, callback: (tx: any) => unknown) => callback(prisma),
}));

const context: AuthContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  deviceId: null,
  sessionId: 'session-1',
  workspace: 'SETTINGS',
  roles: ['CENTRAL_ADMIN'],
  permissions: [PERMISSIONS.BUSINESS_CYCLE_VIEW, PERMISSIONS.BUSINESS_CYCLE_MANAGE],
};

function makePrisma(overrides: Record<string, unknown> = {}) {
  const tx: any = {
    branch: { findFirst: jest.fn(async () => ({ id: 'branch-1' })) },
    businessCycle: {
      findFirst: jest.fn(async () => ({ id: 'cycle-old', tenantId: 'tenant-1', branchId: 'branch-1', name: 'Old', status: 'OPEN' })),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => ({ id: data.id, ...data, openedAt: new Date() })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    shift: { count: jest.fn(async () => 0) },
    order: { aggregate: jest.fn(async () => ({ _count: { _all: 2 }, _sum: { total: 125 } })) },
    $executeRaw: jest.fn(async () => 1),
    ...overrides,
  };
  return {
    tx,
    prisma: {
      $transaction: jest.fn(async (callback: any, _options?: any) => callback(tx)),
    },
  };
}

const audit = { recordWithClient: jest.fn(async (..._args: any[]) => undefined) };

describe('BusinessCycleService lifecycle', () => {
  beforeEach(() => audit.recordWithClient.mockClear());
  it('opens a cycle atomically and writes an audit event', async () => {
    const { prisma, tx } = makePrisma();
    tx.businessCycle.findFirst.mockResolvedValueOnce(null);
    const service = new BusinessCycleService(prisma as never, audit as never);

    const cycle = await service.open(context, { branchId: 'branch-1', name: 'Morning' });

    expect(cycle.status).toBe('OPEN');
    expect(tx.businessCycle.create).toHaveBeenCalled();
    expect(audit.recordWithClient).toHaveBeenCalledWith(
      tx,
      context,
      expect.objectContaining({ action: 'BUSINESS_CYCLE_OPENED' }),
    );
  });

  it('closes the current cycle with a persisted summary', async () => {
    const { prisma, tx } = makePrisma();
    const service = new BusinessCycleService(prisma as never, audit as never);

    const result = await service.close(context, { branchId: 'branch-1' });

    expect(tx.businessCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'OPEN', branchId: 'branch-1' }),
      data: expect.objectContaining({ status: 'CLOSED', closeSummary: { orderCount: 2, grossSales: 125 } }),
    }));
    expect(result.status).toBe('CLOSED');
  });

  it('starts a new cycle without deleting the old cycle', async () => {
    const { prisma, tx } = makePrisma();
    const service = new BusinessCycleService(prisma as never, audit as never);

    const result = await service.startNew(context, { branchId: 'branch-1', name: 'Next' });

    expect(tx.businessCycle.updateMany).toHaveBeenCalled();
    expect(tx.businessCycle.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'OPEN', name: 'Next' }),
    }));
    expect(result.previous.status).toBe('CLOSED');
    expect(result.current.status).toBe('OPEN');
    expect(audit.recordWithClient).toHaveBeenCalledTimes(2);
  });

  it('blocks close/start-new while a cashier shift is open', async () => {
    const { prisma, tx } = makePrisma();
    tx.shift.count.mockResolvedValue(1);
    const service = new BusinessCycleService(prisma as never, audit as never);

    await expect(service.close(context, { branchId: 'branch-1' })).rejects.toThrow('cashier shifts are open');
    await expect(service.startNew(context, { branchId: 'branch-1', name: 'Next' })).rejects.toThrow('cashier shifts are open');
    expect(tx.businessCycle.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when a concurrent operation already changed the cycle', async () => {
    const { prisma, tx } = makePrisma();
    tx.businessCycle.updateMany.mockResolvedValue({ count: 0 });
    const service = new BusinessCycleService(prisma as never, audit as never);

    await expect(service.close(context, { branchId: 'branch-1' })).rejects.toThrow('changed by another operation');
    expect(audit.recordWithClient).not.toHaveBeenCalled();
  });
});
