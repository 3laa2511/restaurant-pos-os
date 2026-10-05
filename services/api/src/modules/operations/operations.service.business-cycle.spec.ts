import { OperationsService } from './operations.service.js';

jest.mock('../../database/rls-context.js', () => ({
  withRlsContext: async (_prisma: unknown, _context: unknown, callback: (tx: unknown) => unknown) =>
    callback(_prisma),
}));

jest.mock('../auth/authorization.types.js', () => ({
  assertTenantScope: (context: { tenantId: string }) => context.tenantId,
  assertBranchAccess: () => undefined,
}));

describe('OperationsService business-cycle history isolation', () => {
  it('keeps closed-cycle history queryable while excluding it from current-cycle totals', async () => {
    const tenantId = 'tenant-1';
    const branchId = 'branch-1';
    const closedCycleId = 'cycle-closed';
    const openCycleId = 'cycle-open';

    // This represents persisted history: the old order still exists and remains queryable.
    const historicalOrders = [
      {
        id: 'order-old',
        cycleId: closedCycleId,
        total: 100,
        status: 'COMPLETED',
      },
    ];

    const currentOrders = [
      {
        id: 'order-current',
        cycleId: openCycleId,
        total: 25,
        status: 'COMPLETED',
      },
    ];

    const prisma = {
      businessCycle: {
        findMany: jest.fn().mockResolvedValue([{ id: openCycleId }]),
      },
      order: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'COMPLETED', _count: { _all: 1 }, _sum: { total: 25 } },
        ]),
        findMany: jest.fn().mockResolvedValue([...historicalOrders, ...currentOrders]),
      },
      customer: { count: jest.fn().mockResolvedValue(1) },
      branch: { count: jest.fn().mockResolvedValue(1) },
    };

    const service = new OperationsService(prisma as never);
    const context = {
      tenantId,
      branchId,
      userId: 'user-1',
      sessionId: 'session-1',
      permissions: ['report.view.operational'],
    } as never;

    const history = await prisma.order.findMany({
      where: { branch: { tenantId, id: branchId } },
      orderBy: { createdAt: 'desc' },
    });
    const overview = await service.managementOverview(context, branchId);

    expect(history).toHaveLength(2);
    expect(history.map((order) => order.id)).toEqual(['order-old', 'order-current']);

    expect(prisma.businessCycle.findMany).toHaveBeenCalledWith({
      where: { tenantId, status: 'OPEN', branchId },
      select: { id: true },
    });
    expect(prisma.order.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          branch: { tenantId, id: branchId },
          cycleId: { in: [openCycleId] },
        },
      }),
    );

    expect(overview.orders).toEqual([
      { status: 'COMPLETED', count: 1, total: 25 },
    ]);
    expect(overview.orders).not.toContainEqual(
      expect.objectContaining({ total: 125 }),
    );
  });
});
