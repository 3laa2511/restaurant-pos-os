import { OperationsService } from './operations.service.js';

jest.mock('../../database/rls-context.js', () => ({
  withRlsContext: async (_prisma: unknown, _context: unknown, callback: (tx: unknown) => unknown) =>
    callback(_prisma),
}));

jest.mock('../auth/authorization.types.js', () => ({
  assertTenantScope: (context: { tenantId: string }) => context.tenantId,
  assertBranchAccess: (context: { branchId: string | null }, branchId: string) => {
    if (context.branchId !== null && context.branchId !== branchId) {
      throw new Error('Forbidden: branch access denied');
    }
  },
}));

describe('OperationsService session branch isolation', () => {
  const context = {
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    userId: 'user-1',
    sessionId: 'session-1',
    permissions: ['order.view', 'report.view.operational'],
  } as never;

  it('defaults call-center orders to the authenticated session branch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new OperationsService({ order: { findMany } } as never);

    await service.callCenterOrders(context);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { branch: { tenantId: 'tenant-1', id: 'branch-1' }, source: 'CALL_CENTER' },
    }));
  });

  it('defaults dispatch orders to the authenticated session branch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new OperationsService({ order: { findMany } } as never);

    await service.dispatchOrders(context);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        branch: { tenantId: 'tenant-1', id: 'branch-1' },
        type: 'DELIVERY',
      }),
    }));
  });

  it('keeps the management overview scoped to the authenticated session branch', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'cycle-1' }]);
    const groupBy = jest.fn().mockResolvedValue([]);
    const customerCount = jest.fn().mockResolvedValue(0);
    const branchCount = jest.fn().mockResolvedValue(1);
    const service = new OperationsService({
      businessCycle: { findMany },
      order: { groupBy },
      customer: { count: customerCount },
      branch: { count: branchCount },
    } as never);

    await service.managementOverview(context);

    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', status: 'OPEN', branchId: 'branch-1' },
      select: { id: true },
    });
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        branch: { tenantId: 'tenant-1', id: 'branch-1' },
        cycleId: { in: ['cycle-1'] },
      },
    }));
    expect(branchCount).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', id: 'branch-1' },
    });
    expect(customerCount).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' } });
  });

  it('rejects a request to query another branch', async () => {
    const service = new OperationsService({ order: { findMany: jest.fn() } } as never);

    await expect(service.dispatchOrders(context, 'branch-2')).rejects.toThrow(
      'Forbidden: branch access denied',
    );
  });
});
