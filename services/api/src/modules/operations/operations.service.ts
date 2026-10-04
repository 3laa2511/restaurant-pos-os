import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { withRlsContext } from '../../database/rls-context.js';
import { assertBranchAccess, assertTenantScope } from '../auth/authorization.types.js';
import type { AuthContext } from '../auth/authorization.types.js';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async callCenterOrders(context: AuthContext, branchId?: string) {
    const tenantId = assertTenantScope(context);
    if (branchId) assertBranchAccess(context, branchId);
    return withRlsContext(this.prisma, context, async (tx) =>
      tx.order.findMany({
        where: { tenantId, ...(branchId ? { branchId } : {}), source: 'CALL_CENTER' },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { customer: { include: { addresses: true } }, items: true, branch: true },
      }),
    );
  }

  async dispatchOrders(context: AuthContext, branchId?: string) {
    const tenantId = assertTenantScope(context);
    if (branchId) assertBranchAccess(context, branchId);
    return withRlsContext(this.prisma, context, async (tx) =>
      tx.order.findMany({
        where: {
          tenantId,
          ...(branchId ? { branchId } : {}),
          type: 'DELIVERY',
          status: { in: ['CONFIRMED', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY'] },
        },
        orderBy: { updatedAt: 'asc' },
        take: 100,
        include: { customer: { include: { addresses: true } }, items: true, branch: true },
      }),
    );
  }

  async managementOverview(context: AuthContext, branchId?: string) {
    const tenantId = assertTenantScope(context);
    if (branchId) assertBranchAccess(context, branchId);
    return withRlsContext(this.prisma, context, async (tx) => {
      const where = { tenantId, ...(branchId ? { branchId } : {}) };
      const [orders, customers, branches] = await Promise.all([
        tx.order.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { total: true } }),
        tx.customer.count({ where: { tenantId } }),
        tx.branch.count({ where: { tenantId } }),
      ]);
      return {
        orders: orders.map((row) => ({ status: row.status, count: row._count._all, total: Number(row._sum.total ?? 0) })),
        customers,
        branches,
      };
    });
  }
}
