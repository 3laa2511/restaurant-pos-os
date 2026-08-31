import { randomUUID } from 'node:crypto';
import { OrderRepository, CreateOrderRecord } from './order-repository.port.js';
import { OrderStatus } from './order-status.js';
import { AuthContext, assertBranchAccess, assertPermission } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';

export interface CreateOrderInput {
  branchId: string;
  createdById: string;
  source: string;
  type: string;
  total: string;
  idempotencyKey: string;
}

export interface OrderEventWriter {
  append(event: {
    eventId: string;
    orderId: string;
    branchId: string;
    actorUserId: string | null;
    deviceId: string | null;
    type: string;
    version: number;
    occurredAt: Date;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface AuditWriter {
  append(entry: {
    actorUserId: string;
    branchId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly events: OrderEventWriter,
    private readonly audit: AuditWriter,
  ) {}

  async create(context: AuthContext, input: CreateOrderInput): Promise<CreateOrderRecord> {
    assertPermission(context, PERMISSIONS.ORDER_CREATE);
    assertBranchAccess(context, input.branchId);

    const order = await this.orders.create({
      id: randomUUID(),
      orderNumber: await this.nextOrderNumber(input.branchId),
      branchId: input.branchId,
      createdById: input.createdById,
      source: input.source,
      type: input.type,
      status: OrderStatus.DRAFT,
      total: input.total,
    });

    const occurredAt = new Date();
    await this.events.append({
      eventId: randomUUID(),
      orderId: order.id,
      branchId: order.branchId,
      actorUserId: context.userId,
      deviceId: context.deviceId,
      type: 'ORDER_CREATED',
      version: order.version,
      occurredAt,
      payload: { source: input.source, type: input.type },
    });

    await this.audit.append({
      actorUserId: context.userId,
      branchId: order.branchId,
      action: 'ORDER_CREATED',
      entityType: 'ORDER',
      entityId: order.id,
      metadata: { source: input.source, type: input.type },
    });

    return order;
  }

  private async nextOrderNumber(branchId: string): Promise<string> {
    // Replaced by a transactional branch sequence when the Prisma repository is wired.
    return `${branchId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}
