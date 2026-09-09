import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { RiskPolicyService } from './risk-policy.service.js';

export type AuditRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AuditEventInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  branchId?: string | null;
  deviceId?: string | null;
  reason?: string | null;
  amount?: number | null;
  variance?: number | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface AuditEventResult {
  id: string;
  riskScore: number;
  riskLevel: AuditRiskLevel;
}

function riskLevel(score: number): AuditRiskLevel {
  if (score >= 90) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function jsonValue(value: unknown): Prisma.JsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
}

function finiteMoney(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) throw new Error('Audit amount must be a finite non-negative number');
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskPolicies: RiskPolicyService,
  ) {}

  async record(context: AuthContext, input: AuditEventInput): Promise<AuditEventResult> {
    return this.recordWithClient(this.prisma, context, input);
  }

  async recordWithClient(
    client: PrismaService | Prisma.TransactionClient,
    context: AuthContext,
    input: AuditEventInput,
  ): Promise<AuditEventResult> {
    const branchId = cleanText(input.branchId ?? context.branchId);
    if (branchId) assertBranchAccess(context, branchId);
    const action = cleanText(input.action);
    const entityType = cleanText(input.entityType);
    if (!action) throw new Error('Audit action is required');
    if (!entityType) throw new Error('Audit entity type is required');

    const policy = await this.riskPolicies.resolve(client, action, branchId);
    const reason = cleanText(input.reason);
    if (policy.requiresReason && !reason) {
      throw new Error(`Audit reason is required for ${action}`);
    }
    if (policy.requiresApproval && policy.approvalPermission) {
      assertPermission(context, policy.approvalPermission);
    }

    const amount = finiteMoney(input.amount);
    const variance = finiteMoney(input.variance);
    let score = policy.baseScore;
    if (amount !== null && policy.amountThreshold !== null && amount >= policy.amountThreshold) score += 15;
    if (variance !== null && policy.varianceThreshold !== null && Math.abs(variance) >= policy.varianceThreshold) score += 15;
    score = Math.min(100, score + (!reason && policy.baseScore >= 60 ? 5 : 0));

    const id = randomUUID();
    const metadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      riskScore: score,
      riskLevel: riskLevel(score),
      riskPolicyId: policy.policyId,
      deviceId: cleanText(input.deviceId ?? context.deviceId),
      reason,
      amount,
      variance,
    };
    if (input.before !== undefined) metadata.before = jsonValue(input.before);
    if (input.after !== undefined) metadata.after = jsonValue(input.after);

    await client.auditLog.create({
      data: {
        id,
        actorUserId: context.userId,
        branchId,
        action,
        entityType,
        entityId: cleanText(input.entityId),
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
    return { id, riskScore: score, riskLevel: riskLevel(score) };
  }

  async list(
    context: AuthContext,
    options: { branchId?: string; action?: string; entityType?: string; riskLevel?: AuditRiskLevel; limit?: number },
  ) {
    assertPermission(context, PERMISSIONS.AUDIT_VIEW);
    const branchId = cleanText(options.branchId ?? context.branchId);
    if (branchId) assertBranchAccess(context, branchId);
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const where: Prisma.AuditLogWhereInput = {};
    if (branchId) where.branchId = branchId;
    const action = cleanText(options.action);
    if (action) where.action = action;
    const entityType = cleanText(options.entityType);
    if (entityType) where.entityType = entityType;

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, actorUserId: true, branchId: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true },
    });
    return rows
      .map((row) => {
        const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
        const score = typeof metadata.riskScore === 'number' ? metadata.riskScore : 10;
        return { ...row, riskScore: score, riskLevel: riskLevel(score) };
      })
      .filter((row) => !options.riskLevel || row.riskLevel === options.riskLevel);
  }
}
