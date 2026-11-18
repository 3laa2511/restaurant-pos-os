import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { DiningService } from './dining.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';

function context(): AuthContext {
  return {
    userId: 'manager-1',
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    deviceId: 'device-1',
    sessionId: 'session-1',
    workspace: 'POS',
    roles: ['BRANCH_MANAGER'],
    permissions: [PERMISSIONS.DINING_TABLE_MANAGE],
  };
}

function setup(tickets: Array<{ id: string; status: string; version: number; station: string }>) {
  const tx = {
    $executeRaw: jest.fn<(...args: any[]) => Promise<number>>().mockResolvedValue(1),
    diningTable: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'table-1',
        branchId: 'branch-1',
        status: 'OCCUPIED',
        currentOrderId: 'order-1',
        version: 3,
        currentOrder: { id: 'order-1', status: 'CANCELLED', orderNumber: 'B01-0001' },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    kitchenTicket: {
      findMany: jest.fn().mockResolvedValue(tickets),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
  } as any;
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  } as any;
  const audit = { recordWithClient: jest.fn<(...args: any[]) => Promise<unknown>>().mockResolvedValue({ id: 'audit-1' }) };
  return { tx, prisma, audit, service: new DiningService(prisma, audit as never) };
}

describe('DiningService.clearTable kitchen coupling', () => {
  it('cancels unfinished kitchen tickets and audits each cancellation in the same transaction', async () => {
    const { tx, audit, service } = setup([
      { id: 'ticket-1', status: 'SENT_TO_KITCHEN', version: 2, station: 'KITCHEN' },
      { id: 'ticket-2', status: 'PREPARING', version: 4, station: 'BEVERAGE' },
      { id: 'ticket-3', status: 'COMPLETED', version: 5, station: 'PACKING' },
      { id: 'ticket-4', status: 'CANCELLED', version: 1, station: 'KITCHEN' },
    ]);

    const result = await service.clearTable(context(), 'table-1', 'Customer cancelled order', 3);

    expect(result).toEqual({ tableId: 'table-1', status: 'CLEANING', version: 4 });
    expect(tx.kitchenTicket.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.kitchenTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ticket-1', branchId: 'branch-1', version: 2, status: 'SENT_TO_KITCHEN' },
      data: expect.objectContaining({ status: 'CANCELLED', version: { increment: 1 }, cancellationReason: expect.stringContaining('Customer cancelled order') }),
    }));
    expect(tx.orderEvent.create).toHaveBeenCalledTimes(2);
    expect(audit.recordWithClient).toHaveBeenCalledTimes(3);
    expect(tx.diningTable.updateMany).toHaveBeenCalledTimes(1);
  });

  it('blocks table clearing while a kitchen ticket is READY because READY cannot be cancelled implicitly', async () => {
    const { tx, audit, service } = setup([
      { id: 'ticket-ready', status: 'READY', version: 2, station: 'KITCHEN' },
    ]);

    await expect(service.clearTable(context(), 'table-1', 'Customer cancelled order', 3))
      .rejects.toBeInstanceOf(ConflictException);

    expect(tx.kitchenTicket.updateMany).not.toHaveBeenCalled();
    expect(tx.diningTable.updateMany).not.toHaveBeenCalled();
    expect(audit.recordWithClient).not.toHaveBeenCalled();
  });
});
