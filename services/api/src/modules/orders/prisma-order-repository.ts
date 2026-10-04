import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateOrderRecord, OrderRepository } from './order-repository.port.js';
import type { OrderStatus } from './order-status.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { withRlsContext } from '../../database/rls-context.js';

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, tenantId: string, context: AuthContext): Promise<CreateOrderRecord | null> {
    return withRlsContext(this.prisma, context, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, branch: { tenantId } },
        include: { branch: { select: { tenantId: true } } },
      });
      return order ? this.map(order) : null;
    });
  }

  async create(input: Omit<CreateOrderRecord, 'version'>, context: AuthContext): Promise<CreateOrderRecord> {
    return withRlsContext(this.prisma, context, async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id: input.branchId, tenantId: input.tenantId, active: true },
        select: { id: true, tenantId: true },
      });
      if (!branch) throw new Error('Branch not found in tenant scope');

      const cycle = await tx.businessCycle.findFirst({ where: { tenantId: input.tenantId, branchId: input.branchId, status: 'OPEN' }, select: { id: true } });

      const order = await tx.order.create({
        data: {
          id: input.id,
          orderNumber: input.orderNumber,
          branchId: input.branchId,
          cycleId: cycle?.id,
          createdById: input.createdById,
          source: input.source as never,
          type: input.type as never,
          status: input.status as never,
          total: input.total,
        },
        include: { branch: { select: { tenantId: true } } },
      });
      return this.map(order);
    });
  }

  async transition(
    id: string,
    tenantId: string,
    expectedVersion: number,
    status: OrderStatus,
    context: AuthContext,
  ): Promise<CreateOrderRecord> {
    return withRlsContext(this.prisma, context, async (tx) => {
      const result = await tx.order.updateMany({
        where: { id, version: expectedVersion, branch: { tenantId } },
        data: { status: status as never, version: { increment: 1 } },
      });

      if (result.count !== 1) {
        throw new Error('Order was changed by another operation or does not exist in tenant scope');
      }

      const order = await tx.order.findFirst({
        where: { id, branch: { tenantId } },
        include: { branch: { select: { tenantId: true } } },
      });
      if (!order) throw new Error('Order not found after transition');
      return this.map(order);
    });
  }

  private map(order: {
    id: string;
    orderNumber: string;
    branchId: string;
    branch: { tenantId: string };
    createdById: string;
    source: unknown;
    type: unknown;
    status: unknown;
    total: { toString(): string };
    version: number;
  }): CreateOrderRecord {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      branchId: order.branchId,
      tenantId: order.branch.tenantId,
      createdById: order.createdById,
      source: String(order.source),
      type: String(order.type),
      status: String(order.status) as OrderStatus,
      total: order.total.toString(),
      version: order.version,
    };
  }
}
