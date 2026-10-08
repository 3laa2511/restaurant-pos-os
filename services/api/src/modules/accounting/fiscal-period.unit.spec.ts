import { describe, expect, it, jest } from '@jest/globals';
import { AccountingService } from './accounting.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';

const tenantId = 'tenant-fiscal-test';
const context = {
  userId: 'user-fiscal-test',
  tenantId,
  branchId: null,
  deviceId: null,
  sessionId: 'session-fiscal-test',
  workspace: 'ACCOUNTING',
  roles: [],
  permissions: [PERMISSIONS.ACCOUNTING_MANAGE, PERMISSIONS.ACCOUNTING_POST],
} as unknown as AuthContext;

const balancedLines = [
  { code: '1000', name: 'Cash', type: 'ASSET' as const, debit: 100 },
  { code: '4100', name: 'Sales Revenue', type: 'REVENUE' as const, credit: 100 },
];

function postTx(period: unknown) {
  return {
    $executeRaw: jest.fn(async () => 1),
    fiscalPeriod: { findFirst: jest.fn(async () => period) },
    accountingAccount: {
      findUnique: jest.fn(async ({ where }: { where: { tenantId_code: { code: string } } }) => ({
        id: where.tenantId_code.code,
        tenantId,
        code: where.tenantId_code.code,
        name: where.tenantId_code.code === '1000' ? 'Cash' : 'Sales Revenue',
        type: where.tenantId_code.code === '1000' ? 'ASSET' : 'REVENUE',
        active: true,
        allowPosting: true,
      })),
    },
    journalEntry: { findUnique: jest.fn(async () => null), create: jest.fn(async ({ data }: { data: unknown }) => data) },
  } as any;
}

describe('Accounting fiscal period controls', () => {
  const service = new AccountingService({} as never);

  it('allows posting when an OPEN fiscal period covers the posting date', async () => {
    const tx = postTx({ id: 'period-open', status: 'OPEN' });

    const result = await service.post(tx, context, {
      sourceType: 'FISCAL_TEST',
      sourceId: 'open-period',
      description: 'Open period test',
      lines: balancedLines,
    });

    expect(result).toEqual(expect.objectContaining({ fiscalPeriodId: 'period-open' }));
  });

  it('blocks posting when no OPEN fiscal period covers the posting date', async () => {
    const tx = postTx(null);

    await expect(service.post(tx, context, {
      sourceType: 'FISCAL_TEST',
      sourceId: 'closed-period',
      description: 'Closed period test',
      lines: balancedLines,
    })).rejects.toThrow('No open fiscal period covers the journal entry date');

    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('requires the period lookup to be tenant-scoped and OPEN', async () => {
    const findFirst = jest.fn(async () => ({ id: 'period-open', status: 'OPEN' }));
    const tx = postTx(null) as any;
    tx.fiscalPeriod.findFirst = findFirst;

    await service.post(tx as any, context, {
      sourceType: 'FISCAL_TEST',
      sourceId: 'scope-check',
      description: 'Scope check',
      lines: balancedLines,
    });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId,
        status: 'OPEN',
        periodStart: expect.any(Object),
        periodEnd: expect.any(Object),
      }),
    }));
  });

  it('creates a new fiscal period when it does not overlap an existing period', async () => {
    const created = { id: 'period-new', name: '2026-Q4' };
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      fiscalPeriod: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => created),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(tx)),
    };

    const result = await new AccountingService(prisma as never).createFiscalPeriod(context, {
      name: '2026-Q4',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-12-31T23:59:59.999Z',
    });

    expect(result).toEqual(created);
    expect(tx.fiscalPeriod.create).toHaveBeenCalled();
  });

  it('rejects an overlapping fiscal period before creating it', async () => {
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      fiscalPeriod: {
        findFirst: jest.fn(async () => ({ id: 'period-existing', name: '2026-Q3' })),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(tx)),
    };

    await expect(new AccountingService(prisma as never).createFiscalPeriod(context, {
      name: '2026-Q4',
      periodStart: '2026-09-15T00:00:00.000Z',
      periodEnd: '2026-10-15T00:00:00.000Z',
    })).rejects.toThrow('Fiscal period overlaps existing period: 2026-Q3');

    expect(tx.fiscalPeriod.create).not.toHaveBeenCalled();
  });

  it('rejects invalid fiscal period date ranges', async () => {
    const prisma = { $transaction: jest.fn() };
    await expect(new AccountingService(prisma as never).createFiscalPeriod(context, {
      name: 'invalid',
      periodStart: '2026-12-31T00:00:00.000Z',
      periodEnd: '2026-01-01T00:00:00.000Z',
    })).rejects.toThrow('Fiscal period dates are invalid');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('closes an OPEN fiscal period and records the closing actor', async () => {
    const period = { id: 'period-close', tenantId, status: 'OPEN' };
    const updated = { ...period, status: 'CLOSED', closedById: context.userId };
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      fiscalPeriod: {
        findFirst: jest.fn().mockResolvedValue(period),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(tx)),
    };

    await expect(new AccountingService(prisma as never).closeFiscalPeriod(context, 'period-close'))
      .resolves.toEqual(updated);
    expect(tx.fiscalPeriod.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'period-close' },
      data: expect.objectContaining({
        status: 'CLOSED',
        closedById: context.userId,
      }),
    }));
  });

  it('cannot close an already CLOSED fiscal period', async () => {
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      fiscalPeriod: {
        findFirst: jest.fn(async () => ({ id: 'period-closed', tenantId, status: 'CLOSED' })),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(tx)),
    };

    await expect(new AccountingService(prisma as never).closeFiscalPeriod(context, 'period-closed'))
      .rejects.toThrow('Fiscal period is already closed');
    expect(tx.fiscalPeriod.update).not.toHaveBeenCalled();
  });
});
