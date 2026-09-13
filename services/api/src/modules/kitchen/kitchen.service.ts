import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { assertKitchenTicketTransition, type KitchenTicketStatus } from './kitchen-ticket.policy.js';

const ACTIVE_STATUSES = ['SENT_TO_KITCHEN', 'PREPARING', 'READY'] as const;

@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(context: AuthContext, branchId?: string) {
    assertPermission(context, PERMISSIONS.ORDER_VIEW);
    const scopedBranchId = (branchId ?? context.branchId)?.trim();
    if (scopedBranchId) assertBranchAccess(context, scopedBranchId);

    const orders = await this.prisma.order.findMany({
      where: {
        ...(scopedBranchId ? { branchId: scopedBranchId } : {}),
        status: { in: [...ACTIVE_STATUSES] },
      },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        orderNumber: true,
        type: true,
        status: true,
        version: true,
        branchId: true,
        createdAt: true,
        updatedAt: true,
        items: { select: { id: true, productId: true, quantity: true, notes: true, product: { select: { name: true, nameAr: true } } } },
      },
    });

    return orders.map((order) => ({
      ...order,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        note: item.notes,
        name: item.product.name,
        nameAr: item.product.nameAr,
      })),
    }));
  }

  async transition(context: AuthContext, orderId: string, target: KitchenTicketStatus, reason?: string) {
    assertPermission(context, PERMISSIONS.KITCHEN_TICKET_MANAGE);
    const id = orderId.trim();
    if (!id) throw new Error('orderId is required');
    const cleanReason = reason?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, select: { id: true, orderNumber: true, branchId: true, status: true, version: true } });
      if (!order) throw new Error('Order not found');
      assertBranchAccess(context, order.branchId);
      if (!ACTIVE_STATUSES.includes(order.status as (typeof ACTIVE_STATUSES)[number])) throw new Error(`Order is not active in kitchen: ${order.status}`);

      const from = order.status as KitchenTicketStatus;
      assertKitchenTicketTransition(from, target);
      const updated = await tx.order.updateMany({
        where: { id, version: order.version, status: order.status },
        data: { status: target === 'COMPLETED' ? 'CLOSED' : target, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error('Kitchen order changed concurrently; reload and retry');

      const eventId = randomUUID();
      await tx.orderEvent.create({
        data: {
          id: eventId,
          eventId,
          orderId: order.id,
          type: `KITCHEN_${target}`,
          actorUserId: context.userId,
          deviceId: context.deviceId ?? null,
          payload: { from, to: target, reason: cleanReason },
          occurredAt: new Date(),
        },
      });

      await this.audit.recordWithClient(tx, context, {
        action: `KITCHEN_TICKET_${target}`,
        entityType: 'Order',
        entityId: order.id,
        branchId: order.branchId,
        reason: cleanReason,
        before: { status: from, version: order.version },
        after: { status: target, version: order.version + 1 },
      });

      return { orderId: order.id, orderNumber: order.orderNumber, status: target, version: order.version + 1 };
    });
  }
}
