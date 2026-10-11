import { describe, expect, it, jest } from '@jest/globals';
import { AccountingService } from './accounting.service.js';

describe('AccountingService.reconciliation', () => {
  const context = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    branchId: null,
    deviceId: null,
    sessionId: 'session-1',
    workspace: 'ACCOUNTING',
    roles: [],
    permissions: [],
  } as never;

  function serviceWithData(data: {
    orders?: unknown[];
    saleEntries?: unknown[];
    cogsEntries?: unknown[];
    movements?: unknown[];
    stockBalances?: unknown[];
    inventoryLines?: unknown[];
  }) {
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      order: { findMany: jest.fn(async () => data.orders ?? []) },
      journalEntry: {
        findMany: jest.fn(async (args: { where?: { sourceType?: string } }) =>
          args.where?.sourceType === 'ORDER_SALE' ? data.saleEntries ?? [] : data.cogsEntries ?? []),
      },
      inventoryMovement: { findMany: jest.fn(async () => data.movements ?? []) },
      inventoryStockBalance: { findMany: jest.fn(async () => data.stockBalances ?? []) },
      journalLine: { findMany: jest.fn(async (...args: unknown[]) => { void args; return data.inventoryLines ?? []; }) },
    };
    const prisma = {
      $transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx),
    };
    return { service: new AccountingService(prisma as never), tx };
  }

  it('reports a paid order with a missing sale journal without mutating data', async () => {
    const { service, tx } = serviceWithData({
      orders: [{
        id: 'order-1',
        orderNumber: 'A-001',
        total: '120.00',
        branchId: 'branch-1',
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
        payments: [{ id: 'payment-1', status: 'PAID' }],
      }],
    });

    const report = await service.reconciliation(context, {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
    });

    expect(report.summary.status).toBe('ATTENTION_REQUIRED');
    expect(report.findings).toContainEqual(expect.objectContaining({
      category: 'SALES_REVENUE',
      sourceId: 'order-1',
      expectedRevenue: 120,
      postedRevenue: null,
      status: 'MISSING_JOURNAL',
    }));
    expect(tx.order.findMany).toHaveBeenCalledTimes(1);
    expect(tx.journalEntry.findMany).toHaveBeenCalledTimes(2);
    expect(tx.inventoryMovement.findMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryStockBalance.findMany).toHaveBeenCalledTimes(1);
    expect(tx.journalLine.findMany).toHaveBeenCalledTimes(1);
  });

  it('reports mismatched COGS and inventory valuation without attempting corrections', async () => {
    const { service, tx } = serviceWithData({
      cogsEntries: [{
        sourceId: 'order-2',
        lines: [{ account: { code: '5100' }, debit: '8.00', credit: '0.00' }],
      }],
      movements: [{
        referenceId: 'order-2',
        quantityBaseUnit: '2',
        unitCost: '5.00',
        branchId: 'branch-1',
      }],
      stockBalances: [{
        branchId: 'branch-1',
        quantityBaseUnit: '4',
        averageCostPerBaseUnit: '5.00',
      }],
      inventoryLines: [{ branchId: 'branch-1', debit: '15.00', credit: '0.00' }],
    });

    const report = await service.reconciliation(context, { to: '2026-10-09T00:00:00.000Z' });

    expect(report.findings).toContainEqual(expect.objectContaining({
      category: 'COGS',
      sourceId: 'order-2',
      movementCost: 10,
      postedCogs: 8,
      difference: -2,
      status: 'MISMATCH',
    }));
    expect(report.findings).toContainEqual(expect.objectContaining({
      category: 'INVENTORY_VALUATION',
      branchId: 'branch-1',
      stockValuation: 20,
      inventoryAccountBalance: 15,
      difference: -5,
      status: 'MISMATCH',
    }));
    expect(tx.order.findMany).toHaveBeenCalledTimes(1);
    expect(tx.journalEntry.findMany).toHaveBeenCalledTimes(2);
    expect(tx.inventoryMovement.findMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryStockBalance.findMany).toHaveBeenCalledTimes(1);
    expect(tx.journalLine.findMany).toHaveBeenCalledTimes(1);
    const inventoryQuery = tx.journalLine.findMany.mock.calls[0]?.[0] as {
      where: { entry: { is: { entryDate: { lte: Date } } } };
    };
    expect(inventoryQuery.where.entry.is.entryDate.lte.toISOString()).toBe(report.inventoryValuationAsOf);
    expect(Date.parse(report.inventoryValuationAsOf)).toBeGreaterThan(Date.parse('2026-10-09T00:00:00.000Z'));
  });

  it('does not report a missing COGS journal for zero-cost stock consumption', async () => {
    const { service } = serviceWithData({
      movements: [{
        referenceId: 'order-zero-cost',
        quantityBaseUnit: '2',
        unitCost: '0.00',
        branchId: 'branch-1',
      }],
    });

    const report = await service.reconciliation(context, {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-11T23:59:59.999Z',
    });

    expect(report.findings).not.toContainEqual(expect.objectContaining({
      category: 'COGS',
      sourceId: 'order-zero-cost',
    }));
  });

  it('rejects invalid date ranges before querying the database', async () => {
    const { service, tx } = serviceWithData({});

    await expect(service.reconciliation(context, {
      from: 'not-a-date',
      to: '2026-10-09T00:00:00.000Z',
    })).rejects.toThrow('Reconciliation date range is invalid');

    expect(tx.order.findMany).not.toHaveBeenCalled();
  });
});
