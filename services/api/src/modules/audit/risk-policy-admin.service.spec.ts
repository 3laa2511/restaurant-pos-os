import { describe, expect, it, jest } from '@jest/globals';
import { RiskPolicyAdminService, type RiskPolicyWriteInput } from './risk-policy-admin.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import type { PrismaService } from '../../database/prisma.service.js';

type AsyncMock = jest.Mock<(...args: any[]) => Promise<unknown>>;
const context: AuthContext = { userId: 'admin-1', branchId: null, deviceId: 'device-1', roles: [], permissions: [PERMISSIONS.AUDIT_POLICY_MANAGE] };
const branchContext: AuthContext = { ...context, branchId: 'branch-1' };

function policy(overrides: Record<string, unknown> = {}) {
  return { id: 'policy-1', action: 'PAYMENT_REFUND', branchId: null, baseScore: 60, amountThreshold: null, varianceThreshold: null, requiresReason: true, requiresApproval: false, approvalPermission: null, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null, enabled: true, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides };
}

function buildPrisma() {
  const tx = { riskPolicy: { create: jest.fn() as AsyncMock, update: jest.fn() as AsyncMock }, auditLog: { create: jest.fn() as AsyncMock } };
  const prisma = { riskPolicy: { findMany: jest.fn() as AsyncMock, findUnique: jest.fn() as AsyncMock, create: jest.fn() as AsyncMock, update: jest.fn() as AsyncMock }, $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
  tx.riskPolicy.create.mockResolvedValue(policy()); tx.riskPolicy.update.mockResolvedValue(policy()); tx.auditLog.create.mockResolvedValue({});
  prisma.riskPolicy.create.mockResolvedValue(policy()); prisma.riskPolicy.update.mockResolvedValue(policy()); prisma.riskPolicy.findUnique.mockResolvedValue(policy()); prisma.riskPolicy.findMany.mockResolvedValue([]);
  return { prisma, tx };
}

function validInput(overrides: Partial<RiskPolicyWriteInput> = {}): RiskPolicyWriteInput {
  return { action: 'PAYMENT_REFUND', baseScore: 60, amountThreshold: 500, varianceThreshold: 100, requiresReason: true, requiresApproval: false, effectiveFrom: '2026-09-01T00:00:00.000Z', ...overrides };
}

describe('RiskPolicyAdminService', () => {
  it('creates a normalized policy and writes an audit event atomically', async () => {
    const { prisma, tx } = buildPrisma(); const service = new RiskPolicyAdminService(prisma as unknown as PrismaService);
    await service.create(context, validInput({ amountThreshold: 500.5 }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.riskPolicy.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_REFUND', baseScore: 60, amountThreshold: 500.5, varianceThreshold: 100 }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'RISK_POLICY_CREATED', entityType: 'RiskPolicy' }) }));
  });
  it('rejects an invalid approval permission before writing', async () => {
    const { prisma } = buildPrisma(); const service = new RiskPolicyAdminService(prisma as unknown as PrismaService);
    await expect(service.create(context, validInput({ requiresApproval: true, approvalPermission: 'not.a.permission' }))).rejects.toThrow('Invalid approval permission');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('requires an approval permission when approval is enabled', async () => {
    const { prisma } = buildPrisma(); const service = new RiskPolicyAdminService(prisma as unknown as PrismaService);
    await expect(service.create(context, validInput({ requiresApproval: true }))).rejects.toThrow('approvalPermission is required');
  });
  it('rejects an approval permission when approval is disabled', async () => {
    const { prisma } = buildPrisma(); const service = new RiskPolicyAdminService(prisma as unknown as PrismaService);
    await expect(service.create(context, validInput({ approvalPermission: PERMISSIONS.PAYMENT_REFUND }))).rejects.toThrow('approvalPermission must be omitted');
  });
  it('rejects invalid scores, money precision, and effective date ranges', async () => {
    const { prisma } = buildPrisma(); const service = new RiskPolicyAdminService(prisma as unknown as PrismaService);
    await expect(service.create(context, validInput({ baseScore: 101 }))).rejects.toThrow('baseScore');
    await expect(service.create(context, validInput({ amountThreshold: 1.001 }))).rejects.toThrow('amountThreshold');
    await expect(service.create(context, validInput({ effectiveFrom: '2026-09-02T00:00:00.000Z', effectiveTo: '2026-09-01T00:00:00.000Z' }))).rejects.toThrow('effectiveTo');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('enforces branch access for branch-scoped policy writes', async () => {
    const { prisma } = buildPrisma(); const service = new RiskPolicyAdminService(prisma as unknown as PrismaService);
    await expect(service.create(branchContext, validInput({ branchId: 'branch-2' }))).rejects.toThrow('branch access denied');
  });
  it('updates a policy while preserving the existing effectiveFrom when omitted', async () => {
    const { prisma, tx } = buildPrisma(); const existing = policy({ effectiveFrom: new Date('2026-02-01T00:00:00.000Z') }); prisma.riskPolicy.findUnique.mockResolvedValue(existing); tx.riskPolicy.update.mockResolvedValue(policy({ baseScore: 75 }));
    const service = new RiskPolicyAdminService(prisma as unknown as PrismaService);
    const { effectiveFrom: _omitted, ...input } = validInput({ baseScore: 75 });
    await service.update(context, 'policy-1', input);
    expect(tx.riskPolicy.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ effectiveFrom: existing.effectiveFrom, baseScore: 75 }) }));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('toggles enabled state and records the before/after state', async () => {
    const { prisma, tx } = buildPrisma(); prisma.riskPolicy.findUnique.mockResolvedValue(policy({ enabled: true })); tx.riskPolicy.update.mockResolvedValue(policy({ enabled: false }));
    const service = new RiskPolicyAdminService(prisma as unknown as PrismaService); await service.setEnabled(context, 'policy-1', false);
    expect(tx.riskPolicy.update).toHaveBeenCalledWith({ where: { id: 'policy-1' }, data: { enabled: false } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'RISK_POLICY_DISABLED', metadata: { before: { enabled: true }, after: { enabled: false } } }) }));
  });
  it('lists only enabled policies when requested', async () => {
    const { prisma } = buildPrisma(); const service = new RiskPolicyAdminService(prisma as unknown as PrismaService); await service.list(context, undefined, 'PAYMENT_REFUND', false);
    expect(prisma.riskPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ action: 'PAYMENT_REFUND', enabled: true }) }));
  });
});
