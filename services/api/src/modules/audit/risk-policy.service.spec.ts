import { describe, expect, it, jest } from '@jest/globals';
import { RiskPolicyService } from './risk-policy.service.js';
import type { PrismaService } from '../../database/prisma.service.js';

type AsyncMock = jest.Mock<(...args: any[]) => Promise<unknown>>;

function buildPrisma(rows: unknown[]) {
  const prisma = {
    riskPolicy: { findMany: jest.fn() as AsyncMock },
  };
  prisma.riskPolicy.findMany.mockResolvedValue(rows);
  return prisma;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy-1', action: 'PAYMENT_REFUND', branchId: null, baseScore: 50,
    amountThreshold: null, varianceThreshold: null, requiresReason: false,
    requiresApproval: false, approvalPermission: null, enabled: true,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null,
    ...overrides,
  };
}

describe('RiskPolicyService.resolve', () => {
  it('prefers the branch override over the global policy', async () => {
    const prisma = buildPrisma([
      row({ id: 'branch-policy', branchId: 'branch-1', baseScore: 80 }),
      row({ id: 'global-policy', branchId: null, baseScore: 40 }),
    ]);
    const service = new RiskPolicyService(prisma as unknown as PrismaService);
    await expect(service.resolveForContext('PAYMENT_REFUND', 'branch-1', new Date('2026-09-01T00:00:00.000Z')))
      .resolves.toEqual(expect.objectContaining({ policyId: 'branch-policy', baseScore: 80 }));
  });

  it('falls back to the global policy when no branch override exists', async () => {
    const prisma = buildPrisma([row({ id: 'global-policy', branchId: null, baseScore: 40 })]);
    const service = new RiskPolicyService(prisma as unknown as PrismaService);
    await expect(service.resolveForContext('PAYMENT_REFUND', 'branch-9'))
      .resolves.toEqual(expect.objectContaining({ policyId: 'global-policy', baseScore: 40 }));
  });

  it('returns the safe default when no active policy exists', async () => {
    const prisma = buildPrisma([]);
    const service = new RiskPolicyService(prisma as unknown as PrismaService);
    await expect(service.resolveForContext('PAYMENT_REFUND', 'branch-1'))
      .resolves.toEqual({ baseScore: 10, requiresReason: false, requiresApproval: false, approvalPermission: null, amountThreshold: null, varianceThreshold: null, policyId: null });
  });

  it('passes enabled and effective-date constraints to the database query', async () => {
    const prisma = buildPrisma([]);
    const service = new RiskPolicyService(prisma as unknown as PrismaService);
    const now = new Date('2026-09-09T08:00:00.000Z');
    await service.resolveForContext('PAYMENT_REFUND', 'branch-1', now);
    expect(prisma.riskPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        action: 'PAYMENT_REFUND',
        enabled: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      }),
      take: 20,
    }));
  });

  it('maps thresholds and approval settings into the runtime policy', async () => {
    const prisma = buildPrisma([row({
      id: 'configured', baseScore: 65, amountThreshold: '500.25', varianceThreshold: '25.50',
      requiresReason: true, requiresApproval: true, approvalPermission: 'payment.refund',
    })]);
    const service = new RiskPolicyService(prisma as unknown as PrismaService);
    await expect(service.resolveForContext('PAYMENT_REFUND', null))
      .resolves.toEqual(expect.objectContaining({ baseScore: 65, amountThreshold: 500.25, varianceThreshold: 25.5, requiresReason: true, requiresApproval: true, approvalPermission: 'payment.refund', policyId: 'configured' }));
  });
});
