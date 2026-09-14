import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaService } from '../../database/prisma.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { KitchenService } from './kitchen.service.js';
import type { KitchenTicketStatus } from './kitchen-ticket.policy.js';

type AsyncMock = jest.Mock<(...args: any[]) => Promise<unknown>>;

const context: AuthContext = {
  userId: 'kitchen-user-1',
  branchId: 'branch-1',
  deviceId: 'kitchen-device-1',
  roles: [],
  permissions: [PERMISSIONS.KITCHEN_TICKET_MANAGE],
};

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    orderId: 'order-1',
    branchId: 'branch-1',
    station: 'KITCHEN',
    status: 'PREPARING',
    version: 3,
    order: { orderNumber: 'ORD-1001', status: 'PREPARING', version: 10 },
    ...overrides,
  };
}

function buildPrisma() {
  const tx = {
    kitchenTicket: {
      findUnique: jest.fn() as AsyncMock,
      findMany: jest.fn() as AsyncMock,
      updateMany: jest.fn() as AsyncMock,
    },
    order: { updateMany: jest.fn() as AsyncMock },
    orderEvent: { create: jest.fn() as AsyncMock },
  };
  const prisma = {
    kitchenTicket: { findUnique: jest.fn() as AsyncMock },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  tx.kitchenTicket.findUnique.mockResolvedValue(ticket());
  tx.kitchenTicket.findMany.mockResolvedValue([{ status: 'READY' }]);
  tx.kitchenTicket.updateMany.mockResolvedValue({ count: 1 });
  tx.order.updateMany.mockResolvedValue({ count: 1 });
  tx.orderEvent.create.mockResolvedValue({});
  return { prisma, tx };
}

describe('KitchenService.transitionTicket', () => {
  it('requires a cancellation reason before opening a transaction', async () => {
    const { prisma } = buildPrisma();
    const service = new KitchenService(prisma as unknown as PrismaService, { recordWithClient: jest.fn() } as any);

    await expect(service.transitionTicket(context, 'ticket-1', 'CANCELLED')).rejects.toThrow('Cancellation reason is required');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a stale expected version before mutating the ticket', async () => {
    const { prisma, tx } = buildPrisma();
    const service = new KitchenService(prisma as unknown as PrismaService, { recordWithClient: jest.fn() } as any);

    await expect(service.transitionTicket(context, 'ticket-1', 'READY', undefined, 2)).rejects.toThrow('changed concurrently');
    expect(tx.kitchenTicket.updateMany).not.toHaveBeenCalled();
  });

  it('uses the ticket version in the atomic update and projects the order forward', async () => {
    const { prisma, tx } = buildPrisma();
    const audit = { recordWithClient: jest.fn() as AsyncMock };
    const service = new KitchenService(prisma as unknown as PrismaService, audit as any);

    const result = await service.transitionTicket(context, 'ticket-1', 'READY', '  pass quality check  ', 3);

    expect(tx.kitchenTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ticket-1', version: 3, status: 'PREPARING' },
      data: expect.objectContaining({ status: 'READY', version: { increment: 1 }, readyAt: expect.any(Date) }),
    }));
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', version: 10, status: 'PREPARING' },
      data: { status: 'READY', version: { increment: 1 } },
    });
    expect(tx.orderEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'KITCHEN_TICKET_READY',
        payload: expect.objectContaining({ ticketId: 'ticket-1', from: 'PREPARING', to: 'READY', version: 4, reason: 'pass quality check', orderStatus: 'READY' }),
        occurredAt: expect.any(Date),
      }),
    }));
    expect(audit.recordWithClient).toHaveBeenCalledWith(tx, context, expect.objectContaining({
      action: 'KITCHEN_TICKET_READY',
      entityType: 'KitchenTicket',
      entityId: 'ticket-1',
      before: { status: 'PREPARING', version: 3, station: 'KITCHEN' },
      after: { status: 'READY', version: 4, station: 'KITCHEN' },
    }));
    expect(result).toEqual(expect.objectContaining({ ticketId: 'ticket-1', status: 'READY', version: 4, orderStatus: 'READY', orderVersion: 11 }));
  });

  it('records cancellation reason and cancellation timestamp atomically', async () => {
    const { prisma, tx } = buildPrisma();
    tx.kitchenTicket.findUnique.mockResolvedValue(ticket({ status: 'PREPARING', version: 7 }));
    tx.kitchenTicket.findMany.mockResolvedValue([{ status: 'CANCELLED' }]);
    const audit = { recordWithClient: jest.fn() as AsyncMock };
    const service = new KitchenService(prisma as unknown as PrismaService, audit as any);

    await service.transitionTicket(context, 'ticket-1', 'CANCELLED', '  customer cancelled  ', 7);

    const update = tx.kitchenTicket.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(update.data.status).toBe('CANCELLED');
    expect(update.data.version).toEqual({ increment: 1 });
    expect(update.data.cancelledAt).toBeInstanceOf(Date);
    expect(update.data.cancellationReason).toBe('customer cancelled');
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', version: 10, status: 'PREPARING' },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    expect(audit.recordWithClient).toHaveBeenCalledWith(tx, context, expect.objectContaining({
      reason: 'customer cancelled',
      after: { status: 'CANCELLED', version: 8, station: 'KITCHEN' },
    }));
  });

  it('does not regress an order when ticket projection is behind the authoritative order status', async () => {
    const { prisma, tx } = buildPrisma();
    tx.kitchenTicket.findMany.mockResolvedValue([{ status: 'PREPARING' }]);
    tx.kitchenTicket.findUnique.mockResolvedValue(ticket({ status: 'READY', version: 8, order: { orderNumber: 'ORD-1001', status: 'READY', version: 12 } }));
    const audit = { recordWithClient: jest.fn() as AsyncMock };
    const service = new KitchenService(prisma as unknown as PrismaService, audit as any);

    await service.transitionTicket(context, 'ticket-1', 'COMPLETED', undefined, 8);

    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when the conditional update loses a race', async () => {
    const { prisma, tx } = buildPrisma();
    tx.kitchenTicket.updateMany.mockResolvedValue({ count: 0 });
    const audit = { recordWithClient: jest.fn() as AsyncMock };
    const service = new KitchenService(prisma as unknown as PrismaService, audit as any);

    await expect(service.transitionTicket(context, 'ticket-1', 'READY', undefined, 3)).rejects.toThrow('changed concurrently');
    expect(tx.orderEvent.create).not.toHaveBeenCalled();
    expect(audit.recordWithClient).not.toHaveBeenCalled();
  });

  it('rejects illegal lifecycle transitions before any write', async () => {
    const { prisma, tx } = buildPrisma();
    tx.kitchenTicket.findUnique.mockResolvedValue(ticket({ status: 'COMPLETED', version: 9 }));
    const service = new KitchenService(prisma as unknown as PrismaService, { recordWithClient: jest.fn() } as any);

    await expect(service.transitionTicket(context, 'ticket-1', 'READY' as KitchenTicketStatus, undefined, 9)).rejects.toThrow('Invalid kitchen ticket transition');
    expect(tx.kitchenTicket.updateMany).not.toHaveBeenCalled();
  });
});
