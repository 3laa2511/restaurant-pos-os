import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { setRlsContext, withRlsContext } from '../../database/rls-context.js';
import { assertBranchAccess, assertPermission, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { AuditService } from '../audit/audit.service.js';

export interface OpenBusinessCycleInput { branchId: string; name: string; }
export interface CloseBusinessCycleInput { branchId: string; }

@Injectable()
export class BusinessCycleService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async current(context: AuthContext, branchId: string) {
    const tenantId = assertTenantScope(context);
    assertPermission(context, PERMISSIONS.BUSINESS_CYCLE_VIEW);
    assertBranchAccess(context, branchId);
    return withRlsContext(this.prisma, context, (tx) => tx.businessCycle.findFirst({
      where: { tenantId, branchId, status: 'OPEN' }, orderBy: { openedAt: 'desc' },
    }));
  }

  async open(context: AuthContext, input: OpenBusinessCycleInput) {
    const tenantId = assertTenantScope(context);
    assertPermission(context, PERMISSIONS.BUSINESS_CYCLE_MANAGE);
    if (!input.name?.trim()) throw new Error('Cycle name is required');
    assertBranchAccess(context, input.branchId);
    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);
      const branch = await tx.branch.findFirst({ where: { id: input.branchId, tenantId, active: true }, select: { id: true } });
      if (!branch) throw new Error('Branch not found or inactive');
      const existing = await tx.businessCycle.findFirst({ where: { tenantId, branchId: input.branchId, status: 'OPEN' } });
      if (existing) throw new Error('Branch already has an open business cycle');
      const cycle = await tx.businessCycle.create({ data: { id: randomUUID(), tenantId, branchId: input.branchId, name: input.name.trim(), openedById: context.userId, status: 'OPEN' } });
      await this.audit.recordWithClient(tx, context, { action: 'BUSINESS_CYCLE_OPENED', entityType: 'BUSINESS_CYCLE', entityId: cycle.id, branchId: input.branchId, metadata: { name: cycle.name } });
      return cycle;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async startNew(context: AuthContext, input: { branchId: string; name: string }) {
    const tenantId = assertTenantScope(context);
    assertPermission(context, PERMISSIONS.BUSINESS_CYCLE_MANAGE);
    if (!input.name?.trim()) throw new Error('Cycle name is required');
    assertBranchAccess(context, input.branchId);
    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);
      const branch = await tx.branch.findFirst({ where: { id: input.branchId, tenantId, active: true }, select: { id: true } });
      if (!branch) throw new Error('Branch not found or inactive');
      const current = await tx.businessCycle.findFirst({ where: { tenantId, branchId: input.branchId, status: 'OPEN' } });
      if (!current) throw new Error('No open business cycle exists for this branch');
      const openShifts = await tx.shift.count({ where: { branchId: input.branchId, status: 'OPEN', branch: { tenantId } } });
      if (openShifts > 0) throw new Error('Cannot start a new business cycle while cashier shifts are open');
      const orders = await tx.order.aggregate({ where: { cycleId: current.id, branch: { tenantId } }, _count: { _all: true }, _sum: { total: true } });
      const summary = { orderCount: orders._count._all, grossSales: Number(orders._sum.total ?? 0) };
      const closed = await tx.businessCycle.updateMany({
        where: { id: current.id, status: 'OPEN', tenantId, branchId: input.branchId },
        data: { status: 'CLOSED', closedById: context.userId, closedAt: new Date(), closeSummary: summary },
      });
      if (closed.count !== 1) throw new Error('Business cycle was changed by another operation');
      await this.audit.recordWithClient(tx, context, {
        action: 'BUSINESS_CYCLE_CLOSED', entityType: 'BUSINESS_CYCLE', entityId: current.id,
        branchId: input.branchId, metadata: summary,
      });
      const next = await tx.businessCycle.create({
        data: { id: randomUUID(), tenantId, branchId: input.branchId, name: input.name.trim(), openedById: context.userId, status: 'OPEN' },
      });
      await this.audit.recordWithClient(tx, context, {
        action: 'BUSINESS_CYCLE_OPENED', entityType: 'BUSINESS_CYCLE', entityId: next.id,
        branchId: input.branchId, metadata: { name: next.name, previousCycleId: current.id },
      });
      return { previous: { ...current, status: 'CLOSED', closedById: context.userId, closeSummary: summary }, current: next };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async close(context: AuthContext, input: CloseBusinessCycleInput) {
    const tenantId = assertTenantScope(context);
    assertPermission(context, PERMISSIONS.BUSINESS_CYCLE_MANAGE);
    assertBranchAccess(context, input.branchId);
    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);
      const cycle = await tx.businessCycle.findFirst({ where: { tenantId, branchId: input.branchId, status: 'OPEN' } });
      if (!cycle) throw new Error('No open business cycle exists for this branch');
      const openShifts = await tx.shift.count({ where: { branchId: input.branchId, status: 'OPEN', branch: { tenantId } } });
      if (openShifts > 0) throw new Error('Cannot close business cycle while cashier shifts are open');
      const orders = await tx.order.aggregate({ where: { cycleId: cycle.id, branch: { tenantId } }, _count: { _all: true }, _sum: { total: true } });
      const summary = { orderCount: orders._count._all, grossSales: Number(orders._sum.total ?? 0) };
      const updated = await tx.businessCycle.updateMany({ where: { id: cycle.id, status: 'OPEN', tenantId, branchId: input.branchId }, data: { status: 'CLOSED', closedById: context.userId, closedAt: new Date(), closeSummary: summary } });
      if (updated.count !== 1) throw new Error('Business cycle was changed by another operation');
      await this.audit.recordWithClient(tx, context, { action: 'BUSINESS_CYCLE_CLOSED', entityType: 'BUSINESS_CYCLE', entityId: cycle.id, branchId: input.branchId, metadata: summary });
      return { ...cycle, status: 'CLOSED', closedById: context.userId, closeSummary: summary };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
