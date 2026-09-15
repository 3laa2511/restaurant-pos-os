import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertKitchenStationAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { AuditService } from '../audit/audit.service.js';
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

  async listTickets(context: AuthContext, branchId?: string) {
    assertPermission(context, PERMISSIONS.ORDER_VIEW);
    const scopedBranchId = (branchId ?? context.branchId)?.trim();
    if (scopedBranchId) assertBranchAccess(context, scopedBranchId);

    const args = {
      where: {
        ...(scopedBranchId ? { branchId: scopedBranchId } : {}),
        ...(context.kitchenStation != null ? { station: context.kitchenStation } : {}),
      },
      orderBy: [{ status: 'asc' as const }, { sentAt: 'asc' as const }],
      include: {
        order: { select: { orderNumber: true, type: true } },
        items: { orderBy: { createdAt: 'asc' as const } },
      },
    };

    return this.prisma.kitchenTicket.findMany(args);
  }

  async materializeTickets(context: AuthContext, orderId: string) {
    assertPermission(context, PERMISSIONS.KITCHEN_TICKET_MANAGE);
    const id = orderId.trim();
    if (!id) throw new Error('orderId is required');

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: {
          id: true,
          orderNumber: true,
          branchId: true,
          status: true,
          items: {
            select: {
              id: true,
              quantity: true,
              notes: true,
              productId: true,
              product: { select: { name: true, kitchenStation: true } },
            },
          },
        },
      });
      if (!order) throw new Error('Order not found');
      assertBranchAccess(context, order.branchId);
      if (!['SENT_TO_KITCHEN', 'PREPARING', 'READY'].includes(order.status)) {
        throw new Error(`Order is not active in kitchen: ${order.status}`);
      }
      if (order.items.length === 0) throw new Error('Order has no items');

      const drafts = routeOrderItems(
        order.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          quantity: item.quantity,
          station: item.product.kitchenStation,
          nameSnapshot: item.product.name,
          note: item.notes,
        })),
      );

      const tickets = [];
      for (const draft of drafts) {
        const ticket = await tx.kitchenTicket.upsert({
          where: { orderId_station_sequence: { orderId: order.id, station: draft.station, sequence: 1 } },
          create: {
            orderId: order.id,
            branchId: order.branchId,
            station: draft.station,
            sequence: 1,
            status: 'SENT_TO_KITCHEN',
            items: {
              create: draft.items.map((item) => ({
                orderItemId: item.orderItemId,
                nameSnapshot: item.name,
                quantity: item.quantity,
                note: item.note,
              })),
            },
          },
          update: {},
          include: { items: true },
        });
        tickets.push(ticket);
      }

      return { orderId: order.id, orderNumber: order.orderNumber, tickets };
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
    const id = ticketId.trim();
    if (!id) throw new Error('ticketId is required');
    const cleanReason = reason?.trim() || null;
    if (target === 'CANCELLED' && !cleanReason) throw new Error('Cancellation reason is required');

    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.kitchenTicket.findUnique({
        where: { id },
        select: {
          id: true,
          orderId: true,
          branchId: true,
          station: true,
          status: true,
          version: true,
          order: { select: { orderNumber: true, status: true, version: true } },
        },
      });
      if (!ticket) throw new Error('Kitchen ticket not found');
      assertBranchAccess(context, ticket.branchId);
      assertKitchenStationAccess(context, ticket.station);
      if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
        throw new Error('expectedVersion must be a positive integer');
      }
      if (expectedVersion !== undefined && expectedVersion !== ticket.version) {
        throw new ConflictException('Kitchen ticket changed concurrently; reload and retry');
      }

      const from = ticket.status as KitchenTicketStatus;
      assertKitchenTicketTransition(from, target);
      const now = new Date();
      const updated = await tx.kitchenTicket.updateMany({
        where: { id, version: ticket.version, status: ticket.status },
        data: {
          status: target,
          version: { increment: 1 },
          ...(target === 'PREPARING' ? { preparingAt: now } : {}),
          ...(target === 'READY' ? { readyAt: now } : {}),
          ...(target === 'COMPLETED' ? { completedAt: now } : {}),
          ...(target === 'CANCELLED' ? { cancelledAt: now, cancellationReason: cleanReason } : {}),
        },
      });
      if (updated.count !== 1) throw new ConflictException('Kitchen ticket changed concurrently; reload and retry');

      const siblingTickets = await tx.kitchenTicket.findMany({
        where: { orderId: ticket.orderId },
        select: { status: true },
      });
      const projectedOrderStatus = deriveOrderStatusFromKitchenTickets(
        siblingTickets.map((sibling) => sibling.status as KitchenTicketStatus),
      );

      let orderVersion = ticket.order.version;
      if (shouldAdvanceOrderStatus(ticket.order.status, projectedOrderStatus)) {
        const orderUpdated = await tx.order.updateMany({
          where: { id: ticket.orderId, version: ticket.order.version, status: ticket.order.status },
          data: { status: projectedOrderStatus, version: { increment: 1 } },
        });
        if (orderUpdated.count !== 1) throw new ConflictException('Kitchen order changed concurrently; reload and retry');
        orderVersion += 1;

        const orderEventId = randomUUID();
        await tx.orderEvent.create({
          data: {
            id: orderEventId,
            eventId: orderEventId,
            orderId: ticket.orderId,
            type: `KITCHEN_ORDER_${projectedOrderStatus}`,
            actorUserId: context.userId,
            deviceId: context.deviceId ?? null,
            payload: {
              source: 'KITCHEN_TICKET_PROJECTION',
              ticketId: ticket.id,
              from: ticket.order.status,
              to: projectedOrderStatus,
              version: orderVersion,
            },
            occurredAt: now,
          },
        });

        await this.audit.recordWithClient(tx, context, {
          action: `KITCHEN_ORDER_${projectedOrderStatus}`,
          entityType: 'Order',
          entityId: ticket.orderId,
          branchId: ticket.branchId,
          reason: cleanReason,
          before: { status: ticket.order.status, version: ticket.order.version },
          after: { status: projectedOrderStatus, version: orderVersion },
        });
      }

      const eventId = randomUUID();
      await tx.orderEvent.create({
        data: {
          id: eventId,
          eventId,
          orderId: ticket.orderId,
          type: `KITCHEN_TICKET_${target}`,
          actorUserId: context.userId,
          deviceId: context.deviceId ?? null,
          payload: {
            ticketId: ticket.id,
            station: ticket.station,
            from,
            to: target,
            version: ticket.version + 1,
          },
          occurredAt: now,
        },
      });

      await this.audit.recordWithClient(tx, context, {
        action: `KITCHEN_TICKET_${target}`,
        entityType: 'KitchenTicket',
        entityId: ticket.id,
        branchId: ticket.branchId,
        reason: cleanReason,
        before: { status: ticket.status, version: ticket.version },
        after: { status: target, version: ticket.version + 1 },
      });

      return {
        ticketId: ticket.id,
        orderId: ticket.orderId,
        orderNumber: ticket.order.orderNumber,
        station: ticket.station,
        status: target,
        version: ticket.version + 1,
        orderStatus: projectedOrderStatus,
        orderVersion,
      };
    });
  }

  async transition(
    context: AuthContext,
    orderId: string,
    target: KitchenTicketStatus,
    reason?: string,
  ) {
    assertPermission(context, PERMISSIONS.KITCHEN_TICKET_MANAGE);
    if (context.kitchenStation != null) {
      throw new Error('Station-scoped kitchen users must transition individual tickets');
    }
    const id = orderId.trim();
    if (!id) throw new Error('orderId is required');
    const cleanReason = reason?.trim() || null;
    if (target === 'CANCELLED' && !cleanReason) throw new Error('Cancellation reason is required');

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: { id: true, branchId: true, status: true, version: true },
      });
      if (!order) throw new Error('Order not found');
      assertBranchAccess(context, order.branchId);
      const from = order.status as KitchenTicketStatus;
      assertKitchenTicketTransition(from, target);
      const now = new Date();
      const updated = await tx.order.updateMany({
        where: { id: order.id, version: order.version, status: order.status },
        data: { status: target, version: { increment: 1 } },
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
          payload: { from, to: target, version: order.version + 1 },
          occurredAt: now,
        },
      });

      await this.audit.recordWithClient(tx, context, {
        action: `KITCHEN_${target}`,
        entityType: 'Order',
        entityId: order.id,
        branchId: order.branchId,
        reason: cleanReason,
        before: { status: order.status, version: order.version },
        after: { status: target, version: order.version + 1 },
      });

      return { orderId: order.id, status: target, version: order.version + 1 };
    });
  }
}
