import { describe, expect, it, jest } from '@jest/globals';
import { BusinessCycleService } from './business-cycle.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';

const context: AuthContext = {
  userId: 'user-1', tenantId: 'tenant-1', branchId: 'branch-1', deviceId: 'device-1', sessionId: 'session-1',
  workspace: 'MANAGEMENT', roles: ['OWNER'], permissions: [PERMISSIONS.BUSINESS_CYCLE_VIEW, PERMISSIONS.BUSINESS_CYCLE_MANAGE],
};

function createHarness(overrides: Record<string, any> = {}) {
  const cycle = { id: 'cycle-1', tenantId: 'tenant-1', branchId: 'branch-1', name: 'Cycle 1', status: 'OPEN', openedById: 'user-1', closedById: null, openedAt: new Date('2026-10-01T00:00:00Z'), closedAt: null, closeSummary: null };
  const nextCycle = { ...cycle, id: 'cycle-2', name: 'Cycle 2' };
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
    businessCycle: {
      findFirst: jest.fn().mockResolvedValue(cycle),
      create: jest.fn().mockResolvedValue(nextCycle),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    shift: { count: jest.fn().mockResolvedValue(0) },
    order: { aggregate: jest.fn().mockResolvedValue({ _count: { _all: 3 }, _sum: { total: 125 } }) },
  };
  Object.assign(tx, overrides.tx ?? {});
  const prisma: any = { $transaction: jest.fn(async (callback: any, _options?: any) => callback(tx)) };
  const audit = { recordWithClient: jest.fn().mockResolvedValue(undefined) };
  return { service: new BusinessCycleService(prisma as never, audit as never), tx, prisma, audit, cycle, nextCycle };
}

describe('BusinessCycleService', () => {
  it('opens a cycle atomically and records an audit event', async () => {
    const h = createHarness();
    (h.tx.businessCycle.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const result = await h.service.open(context, { branchId: 'branch-1', name: 'October' });
    expect(h.tx.businessCycle.create).toHaveBeenCalled();
    expect(result.status).toBe('OPEN');
    expect(h.audit.recordWithClient).toHaveBeenCalledWith(h.tx, context, expect.objectContaining({ action: 'BUSINESS_CYCLE_OPENED' }));
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
  });

  it('sets transaction-local RLS context before business-cycle reads and writes', async () => {
    const h = createHarness();
    (h.tx.businessCycle.findFirst as jest.Mock).mockResolvedValueOnce(null);
    await h.service.open(context, { branchId: 'branch-1', name: 'RLS' });
    expect(h.tx.$executeRaw).toHaveBeenCalled();
  });

  it('rejects opening a second cycle for the same branch', async () => {
    const h = createHarness();
    await expect(h.service.open(context, { branchId: 'branch-1', name: 'Duplicate' })).rejects.toThrow('Branch already has an open business cycle');
    expect(h.tx.businessCycle.create).not.toHaveBeenCalled();
  });

  it('closes the current cycle and stores its summary', async () => {
    const h = createHarness();
    const result = await h.service.close(context, { branchId: 'branch-1' });
    expect(h.tx.businessCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'cycle-1', status: 'OPEN' }), data: expect.objectContaining({ status: 'CLOSED', closedById: 'user-1' }) }));
    expect(result.closeSummary).toEqual({ orderCount: 3, grossSales: 125 });
    expect(h.audit.recordWithClient).toHaveBeenCalledWith(h.tx, context, expect.objectContaining({ action: 'BUSINESS_CYCLE_CLOSED', entityType: 'BUSINESS_CYCLE' }));
  });

  it('closes the old cycle and opens the next one in one transaction', async () => {
    const h = createHarness();
    const result = await h.service.startNew(context, { branchId: 'branch-1', name: 'Cycle 2' });
    expect(h.tx.businessCycle.updateMany).toHaveBeenCalled();
    expect(h.tx.businessCycle.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'OPEN', name: 'Cycle 2', openedById: 'user-1' }) }));
    expect(result.previous.status).toBe('CLOSED');
    expect(result.current.status).toBe('OPEN');
    expect(h.audit.recordWithClient).toHaveBeenCalledTimes(2);
  });

  it('blocks cycle rollover while a cashier shift is open', async () => {
    const h = createHarness();
    (h.tx.shift.count as jest.Mock).mockResolvedValue(1);
    await expect(h.service.startNew(context, { branchId: 'branch-1', name: 'Cycle 2' })).rejects.toThrow('Cannot start a new business cycle while cashier shifts are open');
    expect(h.tx.businessCycle.updateMany).not.toHaveBeenCalled();
    expect(h.tx.businessCycle.create).not.toHaveBeenCalled();
  });

  it('allows only one winner when two rollover transactions race on the same OPEN cycle', async () => {
    const h = createHarness();
    let calls = 0;
    (h.tx.businessCycle.updateMany as jest.Mock).mockImplementation(async () => (++calls === 1 ? { count: 1 } : { count: 0 }));
    const results = await Promise.allSettled([
      h.service.startNew(context, { branchId: 'branch-1', name: 'Race A' }),
      h.service.startNew(context, { branchId: 'branch-1', name: 'Race B' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('fails safely when another transaction changes the open cycle first', async () => {
    const h = createHarness();
    (h.tx.businessCycle.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(h.service.startNew(context, { branchId: 'branch-1', name: 'Cycle 2' })).rejects.toThrow('Business cycle was changed by another operation');
    expect(h.tx.businessCycle.create).not.toHaveBeenCalled();
  });
});