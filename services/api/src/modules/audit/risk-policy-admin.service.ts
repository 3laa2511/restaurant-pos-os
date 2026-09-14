import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS, type PermissionCode } from '../auth/rbac.constants.js';

export interface RiskPolicyWriteInput {
  action: string;
  branchId?: string | null;
  baseScore: number;
  amountThreshold?: number | null;
  varianceThreshold?: number | null;
  requiresReason?: boolean;
  requiresApproval?: boolean;
  approvalPermission?: string | null;
  effectiveFrom?: string | Date;
  effectiveTo?: string | Date | null;
  enabled?: boolean;
}

const MAX_SCORE = 100;
const MAX_MONEY = 9_999_999_999.99;

function text(value: string | null | undefined, field: string): string | null {
  const result = value?.trim() ?? null;
  if (field !== 'approvalPermission' && !result) throw new Error(`${field} is required`);
  return result;
}

function money(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONEY || Math.round(value * 100) !== value * 100) {
    throw new Error(`${field} must be a finite amount from 0 to ${MAX_MONEY} with at most 2 decimals`);
  }
  return Math.round(value * 100) / 100;
}

function date(value: string | Date | null | undefined, field: string, fallback?: Date): Date {
  if (value === undefined || value === null) {
    if (fallback) return fallback;
    throw new Error(`${field} is required`);
  }
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) throw new Error(`${field} must be a valid date`);
  return result;
}

function permission(value: string | null | undefined): PermissionCode | null {
  const normalized = value?.trim() || null;
  if (!normalized) return null;
  const allowed = Object.values(PERMISSIONS) as readonly string[];
  if (!allowed.includes(normalized)) throw new Error(`Invalid approval permission: ${normalized}`);
  return normalized as PermissionCode;
}

@Injectable()
export class RiskPolicyAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private authorize(context: AuthContext, branchId?: string | null): void {
    assertPermission(context, PERMISSIONS.AUDIT_POLICY_MANAGE);
    if (branchId) assertBranchAccess(context, branchId);
  }

  private normalize(input: RiskPolicyWriteInput, existingEffectiveFrom?: Date, existingEffectiveTo?: Date | null) {
    const action = text(input.action, 'action')!;
    const baseScore = input.baseScore;
    if (!Number.isInteger(baseScore) || baseScore < 0 || baseScore > MAX_SCORE) {
      throw new Error('baseScore must be an integer between 0 and 100');
    }
    const amountThreshold = money(input.amountThreshold, 'amountThreshold');
    const varianceThreshold = money(input.varianceThreshold, 'varianceThreshold');
    const requiresApproval = input.requiresApproval ?? false;
    const approvalPermission = permission(input.approvalPermission);
    if (requiresApproval && !approvalPermission) throw new Error('approvalPermission is required when requiresApproval is true');
    if (!requiresApproval && approvalPermission) throw new Error('approvalPermission must be omitted when requiresApproval is false');

    const effectiveFrom = date(input.effectiveFrom, 'effectiveFrom', existingEffectiveFrom ?? new Date());
    // Omitted effectiveTo means "no end date" on create and preserves the existing
    // value on update. Explicit null intentionally clears the end date.
    const effectiveTo = input.effectiveTo === undefined
      ? (existingEffectiveTo ?? null)
      : input.effectiveTo === null
        ? null
        : date(input.effectiveTo, 'effectiveTo');
    if (effectiveTo && effectiveTo <= effectiveFrom) throw new Error('effectiveTo must be later than effectiveFrom');

    return {
      action,
      branchId: input.branchId?.trim() || null,
      baseScore,
      amountThreshold,
      varianceThreshold,
      requiresReason: input.requiresReason ?? false,
      requiresApproval,
      approvalPermission,
      effectiveFrom,
      effectiveTo,
      enabled: input.enabled ?? true,
    };
  }

  async list(context: AuthContext, branchId?: string, action?: string, includeDisabled = true) {
    this.authorize(context, branchId);
    return this.prisma.riskPolicy.findMany({
      where: {
        ...(branchId ? { branchId } : context.branchId ? { branchId: context.branchId } : {}),
        ...(action?.trim() ? { action: action.trim() } : {}),
        ...(includeDisabled ? {} : { enabled: true }),
      },
      orderBy: [{ action: 'asc' }, { branchId: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async create(context: AuthContext, input: RiskPolicyWriteInput) {
    this.authorize(context, input.branchId);
    const data = this.normalize(input);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.riskPolicy.create({ data });
      await tx.auditLog.create({
        data: {
          actorUserId: context.userId,
          branchId: data.branchId ?? context.branchId,
          action: 'RISK_POLICY_CREATED',
          entityType: 'RiskPolicy',
          entityId: created.id,
          metadata: { after: { ...data, id: created.id } },
        },
      });
      return created;
    });
  }

  async update(context: AuthContext, id: string, input: RiskPolicyWriteInput) {
    const existing = await this.prisma.riskPolicy.findUnique({ where: { id } });
    if (!existing) throw new Error('Risk policy not found');
    this.authorize(context, input.branchId ?? existing.branchId);
    const data = this.normalize(input, existing.effectiveFrom, existing.effectiveTo);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.riskPolicy.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          actorUserId: context.userId,
          branchId: updated.branchId ?? context.branchId,
          action: 'RISK_POLICY_UPDATED',
          entityType: 'RiskPolicy',
          entityId: id,
          metadata: {
            before: { id: existing.id, action: existing.action, branchId: existing.branchId, baseScore: existing.baseScore, amountThreshold: existing.amountThreshold?.toString() ?? null, varianceThreshold: existing.varianceThreshold?.toString() ?? null, requiresReason: existing.requiresReason, requiresApproval: existing.requiresApproval, approvalPermission: existing.approvalPermission, effectiveFrom: existing.effectiveFrom.toISOString(), effectiveTo: existing.effectiveTo?.toISOString() ?? null, enabled: existing.enabled },
            after: { ...data, id },
          },
        },
      });
      return updated;
    });
  }

  async setEnabled(context: AuthContext, id: string, enabled: boolean) {
    const existing = await this.prisma.riskPolicy.findUnique({ where: { id } });
    if (!existing) throw new Error('Risk policy not found');
    this.authorize(context, existing.branchId);
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.riskPolicy.update({ where: { id }, data: { enabled } });
      await tx.auditLog.create({
        data: {
          actorUserId: context.userId,
          branchId: policy.branchId ?? context.branchId,
          action: enabled ? 'RISK_POLICY_ENABLED' : 'RISK_POLICY_DISABLED',
          entityType: 'RiskPolicy',
          entityId: id,
          metadata: { before: { enabled: existing.enabled }, after: { enabled } },
        },
      });
      return policy;
    });
  }
}
