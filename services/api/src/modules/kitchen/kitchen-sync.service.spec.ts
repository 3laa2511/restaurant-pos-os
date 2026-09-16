import { createHash } from 'node:crypto';
import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaService } from '../../database/prisma.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import type { SyncEnvelope } from '../sync/sync-contract.js';
import { KitchenSyncService } from './kitchen-sync.service.js';
import type { KitchenService } from './kitchen.service.js';

type AsyncMock = jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;

const context: AuthContext = {
  userId: 'kitchen-user-1',
  branchId: 'branch-1',
  deviceId: 'device-1',
  roles: [],
  permissions: [PERMISSIONS.KITCHEN_TICKET_MANAGE],
};

function asyncMock(): AsyncMock { return jest.fn(async () => undefined); }

function envelope(overrides: Partial<SyncEnvelope> = {}): SyncEnvelope {
  return {
    id: 'sync-envelope-1',
    deviceId: 'device-1',
    branchId: 'branch-1',
    operation: 'UPDATE',
    entityType: 'KITCHEN_TICKET',
    entityId: 'ticket-1',
    idempotencyKey: 'device-1:kitchen:ticket-1:3:READY',
    clientSequence: 1,
    occurredAt: '2026-09-16T10:00:00.000Z',
    payload: { target: 'READY', expectedVersion: 3, reason: null },
    ...overrides,
  };
}

function hash(input: SyncEnvelope): string { return createHash('sha256').update(JSON.stringify(input)).digest('hex'); }

function build() {
  const prisma = {
    syncOperation: { findUnique: asyncMock(), create: asyncMock(), update: asyncMock() },
    kitchenTicket: { findUnique: asyncMock() },
  };
  const kitchen = { transitionTicket: asyncMock() };
  const service = new KitchenSyncService(prisma as unknown as PrismaService, kitchen as unknown as KitchenService);
  prisma.syncOperation.create.mockResolvedValue({});
  prisma.syncOperation.update.mockResolvedValue({});
  prisma.kitchenTicket.findUnique.mockResolvedValue({ branchId: 'branch-1', station: 'KITCHEN', status: 'PREPARING', version: 3 });
  return { prisma, kitchen, service };
}

describe('KitchenSyncService.submit', () => {
  it('applies a new command and persists the APPLIED result', async () => {
    const { prisma, kitchen, service } = build();
    kitchen.transitionTicket.mockResolvedValue({ ticketId: 'ticket-1', status: 'READY', version: 4 });
    const result = await service.submit(context, envelope());
    expect(result.status).toBe('APPLIED');
    expect(kitchen.transitionTicket).toHaveBeenCalledWith(context, 'ticket-1', 'READY', undefined, 3);
    expect(prisma.syncOperation.create).toHaveBeenCalledTimes(1);
    expect(prisma.syncOperation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPLIED', result }) }));
  });

  it('returns the stored result for an exact idempotent retry without reapplying', async () => {
    const { prisma, kitchen, service } = build();
    const input = envelope();
    prisma.syncOperation.findUnique.mockResolvedValue({ operationId: 'operation-1', requestHash: hash(input), result: { status: 'APPLIED', operationId: 'operation-1' }, status: 'APPLIED' });
    const result = await service.submit(context, input);
    expect(result).toEqual({ status: 'APPLIED', operationId: 'operation-1' });
    expect(kitchen.transitionTicket).not.toHaveBeenCalled();
    expect(prisma.syncOperation.create).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when an idempotency key is reused with different payload', async () => {
    const { prisma, kitchen, service } = build();
    prisma.syncOperation.findUnique.mockResolvedValue({ operationId: 'operation-2', requestHash: 'different-hash', result: { status: 'APPLIED', operationId: 'operation-2' }, status: 'APPLIED' });
    const result = await service.submit(context, envelope());
    expect(result).toEqual(expect.objectContaining({ status: 'CONFLICT', operationId: 'operation-2' }));
    expect(kitchen.transitionTicket).not.toHaveBeenCalled();
  });

  it('returns CONFLICT for a stale version and records the conflict result', async () => {
    const { prisma, kitchen, service } = build();
    kitchen.transitionTicket.mockRejectedValue(new Error('Kitchen ticket changed concurrently'));
    prisma.kitchenTicket.findUnique.mockResolvedValue({ branchId: 'branch-1', station: 'KITCHEN', status: 'PREPARING', version: 3 });
    const result = await service.submit(context, envelope());
    expect(result).toEqual(expect.objectContaining({ status: 'CONFLICT', reason: 'Kitchen ticket changed concurrently' }));
    expect(prisma.syncOperation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CONFLICT', result }) }));
  });

  it('recovers an interrupted RECEIVED operation when the intended state is already applied', async () => {
    const { prisma, kitchen, service } = build();
    const input = envelope();
    prisma.syncOperation.findUnique.mockResolvedValue({ operationId: 'operation-3', requestHash: hash(input), result: null, status: 'RECEIVED' });
    prisma.kitchenTicket.findUnique.mockResolvedValue({ branchId: 'branch-1', station: 'KITCHEN', status: 'READY', version: 4 });
    const result = await service.submit(context, input);
    expect(result).toEqual({ status: 'APPLIED', operationId: 'operation-3' });
    expect(kitchen.transitionTicket).not.toHaveBeenCalled();
    expect(prisma.syncOperation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { operationId: 'operation-3' }, data: expect.objectContaining({ status: 'APPLIED', result }) }));
  });

  it('returns CONFLICT for an unresolved RECEIVED operation instead of guessing success', async () => {
    const { prisma, kitchen, service } = build();
    const input = envelope();
    prisma.syncOperation.findUnique.mockResolvedValue({ operationId: 'operation-4', requestHash: hash(input), result: null, status: 'RECEIVED' });
    const result = await service.submit(context, input);
    expect(result).toEqual(expect.objectContaining({ status: 'CONFLICT', operationId: 'operation-4' }));
    expect(kitchen.transitionTicket).not.toHaveBeenCalled();
    expect(prisma.syncOperation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CONFLICT', result }) }));
  });

  it('rejects unsupported operations without creating a durable operation', async () => {
    const { prisma, kitchen, service } = build();
    const result = await service.submit(context, envelope({ operation: 'CREATE' }));
    expect(result.status).toBe('REJECTED');
    expect(kitchen.transitionTicket).not.toHaveBeenCalled();
    expect(prisma.syncOperation.create).not.toHaveBeenCalled();
  });

  it('rejects a device that is not bound to the authenticated session', async () => {
    const { prisma, kitchen, service } = build();
    await expect(service.submit(context, envelope({ deviceId: 'other-device' }))).rejects.toThrow('device access denied');
    expect(prisma.syncOperation.findUnique).not.toHaveBeenCalled();
    expect(kitchen.transitionTicket).not.toHaveBeenCalled();
  });
});
