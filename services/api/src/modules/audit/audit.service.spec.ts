import { describe, expect, it, jest } from '@jest/globals';
import { AuditService, type AuditRiskLevel } from './audit.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';

type AsyncMock = jest.Mock<(...args: any[]) => Promise<unknown>>;

const context: AuthContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  deviceId: 'device-1',
  sessionId: 'session-1',
  workspace: 'MANAGEMENT',
  roles: [],
  permissions: [PERMISSIONS.AUDIT_VIEW],
};

function buildPrisma() {
  const prisma = {
    auditLog: { findMany: jest.fn() as AsyncMock },
    $transaction: jest.fn<(...args: any[]) => Promise<unknown>>(),
  };
  prisma.auditLog.findMany.mockResolvedValue([]);
  prisma.$transaction.mockImplementation(async (callback) =>
    callback({ $executeRaw: jest.fn<(...args: any[]) => Promise<number>>().mockResolvedValue(4), auditLog: prisma.auditLog } as any),
  );
  return prisma;
}

function buildRiskPolicies() {
  return { resolve: jest.fn() as AsyncMock };
}

describe('AuditService.list', () => {
  it('pushes actor, device, risk, date and branch filters into the database query', async () => {
    const prisma = buildPrisma();
    const riskPolicies = buildRiskPolicies();
    const service = new AuditService(prisma as unknown as PrismaService, riskPolicies as never);
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-10T00:00:00.000Z');

    await service.list(context, {
      branchId: 'branch-1',
      action: 'PAYMENT_REFUNDED',
      entityType: 'Payment',
      actorUserId: 'user-9',
      deviceId: 'device-9',
      riskLevel: 'HIGH' as AuditRiskLevel,
      from,
      to,
      limit: 25,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        branchId: 'branch-1',
        action: 'PAYMENT_REFUNDED',
        entityType: 'Payment',
        actorUserId: 'user-9',
        AND: [
          { metadata: { path: ['deviceId'], equals: 'device-9' } },
          { metadata: { path: ['riskLevel'], equals: 'HIGH' } },
        ],
        createdAt: { gte: from, lt: to },
      },),
      take: 26,
    }));
  });

  it('returns a bounded page and a cursor when more rows exist', async () => {
    const prisma = buildPrisma();
    const riskPolicies = buildRiskPolicies();
    const service = new AuditService(prisma as unknown as PrismaService, riskPolicies as never);
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `audit-${index + 1}`,
      actorUserId: 'user-1',
      branchId: 'branch-1',
      action: 'ORDER_CANCELLED',
      entityType: 'Order',
      entityId: `order-${index + 1}`,
      metadata: { riskScore: 60, riskLevel: 'MEDIUM', deviceId: 'device-1' },
      createdAt: new Date(`2026-09-0${index + 1}T10:00:00.000Z`),
    }));
    prisma.auditLog.findMany.mockResolvedValue(rows);

    const result = await service.list(context, { limit: 2 });

    expect(result.data).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('audit-2');
    expect(result.data[0]?.riskLevel).toBe('MEDIUM');
  });

  it('rejects an invalid date range before querying', async () => {
    const prisma = buildPrisma();
    const riskPolicies = buildRiskPolicies();
    const service = new AuditService(prisma as unknown as PrismaService, riskPolicies as never);
    await expect(service.list(context, {
      from: new Date('2026-09-10T00:00:00.000Z'),
      to: new Date('2026-09-09T00:00:00.000Z'),
    })).rejects.toThrow('to must be later than from');
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});
