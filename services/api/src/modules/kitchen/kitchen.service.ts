import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertKitchenStationAccess, assertPermission, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { OrderStatus } from '../../generated/prisma/enums.js';
import { routeOrderItems } from './kitchen-routing.js';
import { deriveOrderStatusFromKitchenTickets, shouldAdvanceOrderStatus } from './kitchen-order-projection.js';
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
    const tenantId = assertTenantScope(context);
    const scopedBranchId = (branchId ?? context.branchId)?.trim();
    if (scopedBranchId) assertBranchAccess(context, scopedBranchId);

    return this.prisma.order.findMany({
      where: {
        ...(scopedBranchId ? { branchId: scopedBranchId } : {}),
        branch: { tenantId },
        status: { in: [...ACTIVE_STATUSES] },
      },
      orderBy: { updatedAt: 'asc' },
      include: { items: true },
    });
  }

  async listTickets(context: AuthContext, branchId?: string) {
    assertPermission(context, PERMISSIONS.ORDER_VIEW);
    const tenantId = assertTenantScope(context);
    const scopedBranchId = (branchId ?? context.branchId)?.trim();
    if (scopedBranchId) assertBranchAccess(context, scopedBranchId);

    return this.prisma.kitchenTicket.findMany({
      where: {
        ...(scopedBranchId ? { branchId: scopedBranchId } : {}),
        branch: { tenantId },
        ...(context.kitchenStation != null ? { station: context.kitchenStation } : {}),
        status: { in: ['SENT_TO_KITCHEN', 'PREPARING', 'READY'] },
      },
      include: { items: true, order: { select: { orderNumber: true, type: true } } },
      orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }],
    });
  }

  async materializeTickets(context: AuthContext, orderId: string) {
    assertPermission(context, PERMISSIONS.KITCHEN_TICKET_MANAGE);
    const tenantId = assertTenantScope(context);
    const id = orderId.trim();
    if (!id) throw new Error('orderId is required');

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, branch: { tenantId } },
        select: { id: true, branchId: true, status: true },
      });
      if (!order) throw new Error('Order not found');
      assertBranchAccess(context, order.branchId);

      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: {
          id: true,
          productId: true,
          quantity: true,
          notes: true,
          product: { select: { name: true, kitchenStation: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      const routable = items.map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        station: item.product.kitchenStation,
        nameSnapshot: item.product.name,
        note: item.notes,
      }));
      const drafts = routeOrderItems(routable);

      const existing = await tx.kitchenTicket.findMany({
        where: { orderId: order.id },
        select: { station: true, sequence: true },
      });
      const existingKeys = new Set(existing.map((ticket) => `${ticket.station}:${ticket.sequence}`));
      const created = [];
      for (const draft of drafts) {
        let sequence = 1;
        while (existingKeys.has(`${draft.station}:${sequence}`)) sequence += 1;
        existingKeys.add(`${draft.station}:${sequence}`);

        const ticket = await tx.kitchenTicket.create({
          data: {
            id: randomUUID(),
            orderId: order.id,
            branchId: order.branchId,
            station: draft.station,
            status: 'SENT_TO_KITCHEN',
            sequence,
            version: 1,
            sentAt: new Date(),
            items: {
              create: draft.items.map((item) => ({
                id: randomUUID(),
                orderItemId: item.orderItemId,
                nameSnapshot: item.name,
                quantity: item.quantity,
                note: item.note,
                modifiers: [],
              })),
            },
          },
          include: { items: true },
        });
        created.push(ticket);
      }
      return created;
    });
  }

  async transitionTicket(
    context: AuthContext,
    ticketId: string,
    target: KitchenTicketStatus,
    reason?: string,
    expectedVersion?: number,
  ) {
    assertPermission(context, PERMISSIONS.KITCHEN_TICKET_MANAGE);
    const tenantId = assertTenantScope(context);
    const id = ticketId.trim();
    if (!id) throw new Error('ticketId is required');
    const cleanReason = reason?.trim() || null;
    if (target === 'CANCELLED' && !cleanReason) throw new Error('Cancellation reason is required');

    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.kitchenTicket.findFirst({
        where: { id, branch: { tenantId } },
        select: { id: true, orderId: true, branchId: true, station: true, status: true, version: true },
      });
      if (!ticket) throw new Error('Kitchen ticket not found');
      assertBranchAccess(context, ticket.branchId);
      assertKitchenStationAccess(context, ticket.station);
      if (expectedVersion !== undefined && ticket.version !== expectedVersion) {
        throw new ConflictException('Kitchen ticket changed concurrently; reload and retry');
      }
      assertKitchenTicketTransition(ticket.status, target);

      const now = new Date();
      const updated = await tx.kitchenTicket.updateMany({
        where: { id: ticket.id, version: ticket.version, status: ticket.status },
        data: {
          status: target,
          version: { increment: 1 },
          ...(target === 'SENT_TO_KITCHEN' ? { sentAt: now } : {}),
          ...(target === 'PREPARING' ? { preparingAt: now } : {}),
          ...(target === 'READY' ? { readyAt: now } : {}),
          ...(target === 'COMPLETED' ? { completedAt: now } : {}),
          ...(target === 'CANCELLED' ? { cancelledAt: now, cancellationReason: cleanReason } : {}),
        },
      });
      if (updated.count !== 1) throw new ConflictException('Kitchen ticket changed concurrently; reload and retry');

      const statuses = await tx.kitchenTicket.findMany({
        where: { orderId: ticket.orderId },
        select: { status: true },
      });
      const projected = deriveOrderStatusFromKitchenTickets(statuses.map((entry) => entry.status));
      const order = await tx.order.findFirst({
        where: { id: ticket.orderId, branch: { tenantId } },
        select: { id: true, branchId: true, status: true, version: true, orderNumber: true },
      });
      if (!order) throw new Error('Order not found');

      let orderStatus = order.status;
      let orderVersion = order.version;
      if (shouldAdvanceOrderStatus(order.status, projected)) {
        const orderUpdate = await tx.order.updateMany({
          where: { id: order.id, version: order.version, status: order.status },
          data: { status: projected, version: { increment: 1 } },
        });
        if (orderUpdate.count !== 1) throw new ConflictException('Kitchen order changed concurrently; reload and retry');
        orderStatus = projected;
        orderVersion += 1;

        const eventId = randomUUID();
        await tx.orderEvent.create({
          data: {
            id: eventId,
            eventId,
            orderId: order.id,
            type: `KITCHEN_${projected}`,
            actorUserId: context.userId,
            deviceId: context.deviceId ?? null,
            payload: { source: 'KITCHEN_TICKET', ticketId: ticket.id, status: projected },
            occurredAt: now,
          },
        });
        await this.audit.recordWithClient(tx, context, {
          action: 'ORDER_STATUS_PROJECTED',
          entityType: 'Order',
          entityId: order.id,
          branchId: order.branchId,
          deviceId: context.deviceId ?? null,
          metadata: { source: 'KITCHEN_TICKET', ticketId: ticket.id, status: projected },
        });
      }

      return {
        ticketId: ticket.id,
        orderId: ticket.orderId,
        orderNumber: order.orderNumber,
        station: ticket.station,
        status: target,
        version: ticket.version + 1,
        orderStatus,
        orderVersion,
      };
    });
  }

  async transition(context: AuthContext, orderId: string, target: KitchenTicketStatus, reason?: string) {
    assertPermission(context, PERMISSIONS.KITCHEN_TICKET_MANAGE);
    const tenantId = assertTenantScope(context);
    if (context.kitchenStation != null) throw new Error('Station-scoped kitchen users must transition individual tickets');
    const id = orderId.trim();
    if (!id) throw new Error('orderId is required');
    const cleanReason = reason?.trim() || null;
    if (target === 'CANCELLED' && !cleanReason) throw new Error('Cancellation reason is required');

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, branch: { tenantId } },
        select: { id: true, branchId: true, status: true, version: true },
      });
      if (!order) throw new Error('Order not found');
      assertBranchAccess(context, order.branchId);
      const from = order.status as KitchenTicketStatus;
      assertKitchenTicketTransition(from, target);

      const now = new Date();
      const nextOrderStatus = (() => {
        switch (target) {
          case 'SENT_TO_KITCHEN': return OrderStatus.SENT_TO_KITCHEN;
          case 'PREPARING': return OrderStatus.PREPARING;
          case 'READY': return OrderStatus.READY;
          case 'COMPLETED': return OrderStatus.CLOSED;
          case 'CANCELLED': return OrderStatus.CANCELLED;
        }
      })();

      const updated = await tx.order.updateMany({
        where: { id: order.id, version: order.version, status: order.status },
        data: { status: nextOrderStatus, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Order changed concurrently; reload and retry');

      const eventId = randomUUID();
      await tx.orderEvent.create({
        data: {
          id: eventId,
          eventId,
          orderId: order.id,
          type: `KITCHEN_${target}`,
          actorUserId: context.userId,
          deviceId: context.deviceId ?? null,
          payload: { source: 'LEGACY_KITCHEN_ORDER_TRANSITION', target },
          occurredAt: now,
        },
      });
      await this.audit.recordWithClient(tx, context, {
        action: 'KITCHEN_ORDER_STATUS_CHANGED',
        entityType: 'Order',
        entityId: order.id,
        branchId: order.branchId,
        deviceId: context.deviceId ?? null,
        reason: cleanReason,
        metadata: { from: order.status, to: nextOrderStatus },
      });

      return { ...order, status: nextOrderStatus, version: order.version + 1, updatedAt: now };
    });
  }
}
