import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PERMISSIONS, type PermissionCode } from '../auth/rbac.constants.js';

export interface RiskPolicyResolution {
  baseScore: number;
  requiresReason: boolean;
  requiresApproval: boolean;
  approvalPermission: PermissionCode | null;
  amountThreshold: number | null;
  varianceThreshold: number | null;
  policyId: string | null;
}

const DEFAULT_SCORE = 10;

function permissionCode(value: string | null): PermissionCode | null {
  if (!value) return null;
  const allowed = Object.values(PERMISSIONS) as readonly string[];
  if (!allowed.includes(value)) {
    throw new Error(`Invalid risk policy approval permission: ${value}`);
  }
  return value as PermissionCode;
}

@Injectable()
export class RiskPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    client: PrismaService | Prisma.TransactionClient,
    action: string,
    branchId: string | null,
    now = new Date(),
  ): Promise<RiskPolicyResolution> {
    const where: Prisma.RiskPolicyWhereInput = {
      action,
      enabled: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    };

    const policies = await client.riskPolicy.findMany({
      where,
      orderBy: [{ branchId: 'desc' }, { effectiveFrom: 'desc' }],
      take: 20,
    });

    const branchPolicy = branchId ? policies.find((policy) => policy.branchId === branchId) : undefined;
    const globalPolicy = policies.find((policy) => policy.branchId === null);
    const policy = branchPolicy ?? globalPolicy;

    if (!policy) {
      return {
        baseScore: DEFAULT_SCORE,
        requiresReason: false,
        requiresApproval: false,
        approvalPermission: null,
        amountThreshold: null,
        varianceThreshold: null,
        policyId: null,
      };
    }

    return {
      baseScore: Math.min(100, Math.max(0, policy.baseScore)),
      requiresReason: policy.requiresReason,
      requiresApproval: policy.requiresApproval,
      approvalPermission: permissionCode(policy.approvalPermission),
      amountThreshold: policy.amountThreshold === null ? null : Number(policy.amountThreshold),
      varianceThreshold: policy.varianceThreshold === null ? null : Number(policy.varianceThreshold),
      policyId: policy.id,
    };
  }

  async resolveForContext(action: string, branchId: string | null, now = new Date()) {
    return this.resolve(this.prisma, action, branchId, now);
  }
}
