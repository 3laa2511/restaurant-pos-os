import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { withRlsContext } from '../../database/rls-context.js';
import { assertBranchAccess, assertPermission, assertTenantScope, resolveBranchScope, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { AuditService } from '../audit/audit.service.js';
import type { DiningTableStatus } from '../../generated/prisma/enums.js';

const ASSIGNABLE_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'SENT_TO_KITCHEN', 'PREPARING', 'READY'] as const;
const TERMINAL_ORDER_STATUSES = ['CLOSED', 'CANCELLED', 'VOIDED', 'REFUNDED'] as const;

@Injectable()
export class DiningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(context: AuthContext, requestedBranchId?: string) {
    assertPermission(context, PERMISSIONS.DINING_TABLE_VIEW);
    const tenantId = assertTenantScope(context);
    const branchId = resolveBranchScope(context, requestedBranchId);
    return withRlsContext(this.prisma, context, (tx) => tx.diningArea.findMany({
      where: {
        tenantId,
        active: true,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        tables: {
          orderBy: { number: 'asc' },
          include: {
            currentOrder: { select: { id: true, orderNumber: true, status: true, total: true } },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }));
  }

  async createArea(context: AuthContext, input: { branchId?: string; name: string; nameAr?: string; sortOrder?: number }) {
    assertPermission(context, PERMISSIONS.DINING_TABLE_MANAGE);
    const tenantId = assertTenantScope(context);
    const branchId = this.requireBranch(context, input.branchId);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Area name is required');

    return withRlsContext(this.prisma, context, async (tx) => {
      await this.requireActiveBranch(tx, tenantId, branchId);
      const area = await tx.diningArea.create({
        data: {
          id: randomUUID(),
          tenantId,
          branchId,
          name,
          nameAr: input.nameAr?.trim() || null,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await this.audit.recordWithClient(tx, context, {
        action: 'DINING_AREA_CREATED',
        entityType: 'DiningArea',
        entityId: area.id,
        branchId,
        metadata: { name: area.name },
      });
      return area;
    });
  }

  async createTable(
    context: AuthContext,
    areaId: string,
    input: { number: string; name?: string; nameAr?: string; seats: number },
  ) {
    assertPermission(context, PERMISSIONS.DINING_TABLE_MANAGE);
    const tenantId = assertTenantScope(context);
    const id = areaId.trim();
    const number = input.number.trim();
    if (!id || !number) throw new BadRequestException('Area and table number are required');
    if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 100) {
      throw new BadRequestException('Table seats must be an integer between 1 and 100');
    }

    return withRlsContext(this.prisma, context, async (tx) => {
      const area = await tx.diningArea.findFirst({
        where: { id, tenantId, active: true },
        select: { id: true, branchId: true },
      });
      if (!area) throw new NotFoundException('Dining area not found');
      assertBranchAccess(context, area.branchId);

      const table = await tx.diningTable.create({
        data: {
          id: randomUUID(),
          tenantId,
          branchId: area.branchId,
          areaId: area.id,
          number,
          name: input.name?.trim() || null,
          nameAr: input.nameAr?.trim() || null,
          seats: input.seats,
          status: 'AVAILABLE',
          version: 1,
        },
      });
      await this.audit.recordWithClient(tx, context, {
        action: 'DINING_TABLE_CREATED',
        entityType: 'DiningTable',
        entityId: table.id,
        branchId: area.branchId,
        metadata: { areaId: area.id, number, seats: input.seats },
      });
      return table;
    });
  }

  async assignOrder(context: AuthContext, tableId: string, orderId: string, expectedVersion?: number) {
    assertPermission(context, PERMISSIONS.ORDER_CREATE);
    const tenantId = assertTenantScope(context);
    const id = tableId.trim();
    const orderKey = orderId.trim();
    if (!id || !orderKey) throw new BadRequestException('tableId and orderId are required');

    return withRlsContext(this.prisma, context, async (tx) => {
      const table = await tx.diningTable.findFirst({
        where: { id, tenantId },
        select: { id: true, branchId: true, status: true, currentOrderId: true, version: true, number: true },
      });
      if (!table) throw new NotFoundException('Dining table not found');
      assertBranchAccess(context, table.branchId);
      if (expectedVersion !== undefined && table.version !== expectedVersion) {
        throw new ConflictException('Dining table changed; refresh and retry');
      }
      if (!['AVAILABLE', 'RESERVED'].includes(table.status) || table.currentOrderId) {
        throw new ConflictException('Dining table is not available for seating');
      }

      const order = await tx.order.findFirst({
        where: { id: orderKey, branchId: table.branchId, branch: { tenantId } },
        select: { id: true, branchId: true, orderNumber: true, type: true, status: true, currentDiningTable: { select: { id: true } } },
      });
      if (!order) throw new NotFoundException('Order not found in this branch');
      if (order.type !== 'DINE_IN') throw new BadRequestException('Only dine-in orders can be assigned to a dining table');
      if (!ASSIGNABLE_ORDER_STATUSES.includes(order.status as (typeof ASSIGNABLE_ORDER_STATUSES)[number])) {
        throw new ConflictException('Order is not in a state that can be seated');
      }
      if (order.currentDiningTable) throw new ConflictException('Order is already assigned to another table');

      const changed = await tx.diningTable.updateMany({
        where: {
          id: table.id,
          version: table.version,
          status: table.status,
          currentOrderId: null,
        },
        data: {
          status: 'OCCUPIED',
          currentOrderId: order.id,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ConflictException('Dining table changed concurrently; refresh and retry');

      const now = new Date();
      const eventId = randomUUID();
      await tx.orderEvent.create({
        data: {
          id: eventId,
          eventId,
          orderId: order.id,
          type: 'DINING_TABLE_ASSIGNED',
          actorUserId: context.userId,
          deviceId: context.deviceId,
          payload: { tableId: table.id, tableNumber: table.number },
          occurredAt: now,
        },
      });
      await this.audit.recordWithClient(tx, context, {
        action: 'DINING_TABLE_ORDER_ASSIGNED',
        entityType: 'DiningTable',
        entityId: table.id,
        branchId: table.branchId,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      });
      return { tableId: table.id, orderId: order.id, orderNumber: order.orderNumber, status: 'OCCUPIED', version: table.version + 1 };
    });
  }

  async clearTable(context: AuthContext, tableId: string, reason: string, expectedVersion?: number) {
    assertPermission(context, PERMISSIONS.DINING_TABLE_MANAGE);
    const tenantId = assertTenantScope(context);
    const id = tableId.trim();
    const cleanReason = reason.trim();
    if (!id || cleanReason.length < 3) throw new BadRequestException('A clear-table reason of at least 3 characters is required');

    return withRlsContext(this.prisma, context, async (tx) => {
      const table = await tx.diningTable.findFirst({
        where: { id, tenantId },
        include: { currentOrder: { select: { id: true, status: true, orderNumber: true } } },
      });
      if (!table) throw new NotFoundException('Dining table not found');
      assertBranchAccess(context, table.branchId);
      if (expectedVersion !== undefined && table.version !== expectedVersion) {
        throw new ConflictException('Dining table changed; refresh and retry');
      }
      if (table.status !== 'OCCUPIED' || !table.currentOrder) {
        throw new ConflictException('Only an occupied table with a linked order can be cleared');
      }
      if (!TERMINAL_ORDER_STATUSES.includes(table.currentOrder.status as (typeof TERMINAL_ORDER_STATUSES)[number])) {
        throw new ConflictException('The linked order must be closed or cancelled before clearing the table');
      }

      const changed = await tx.diningTable.updateMany({
        where: { id: table.id, version: table.version, status: 'OCCUPIED', currentOrderId: table.currentOrder.id },
        data: { status: 'CLEANING', currentOrderId: null, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('Dining table changed concurrently; refresh and retry');

      await this.audit.recordWithClient(tx, context, {
        action: 'DINING_TABLE_CLEARED',
        entityType: 'DiningTable',
        entityId: table.id,
        branchId: table.branchId,
        reason: cleanReason,
        metadata: { previousOrderId: table.currentOrder.id, orderNumber: table.currentOrder.orderNumber, nextStatus: 'CLEANING' },
      });
      return { tableId: table.id, status: 'CLEANING', version: table.version + 1 };
    });
  }

  async updateStatus(context: AuthContext, tableId: string, target: DiningTableStatus, expectedVersion?: number) {
    assertPermission(context, PERMISSIONS.DINING_TABLE_MANAGE);
    const tenantId = assertTenantScope(context);
    const id = tableId.trim();
    const allowedTargets: readonly DiningTableStatus[] = ['AVAILABLE', 'RESERVED', 'OUT_OF_SERVICE'];
    if (!id || !allowedTargets.includes(target)) {
      throw new BadRequestException('Use the dedicated seat and clear actions for OCCUPIED and CLEANING states');
    }

    return withRlsContext(this.prisma, context, async (tx) => {
      const table = await tx.diningTable.findFirst({ where: { id, tenantId } });
      if (!table) throw new NotFoundException('Dining table not found');
      assertBranchAccess(context, table.branchId);
      if (expectedVersion !== undefined && table.version !== expectedVersion) {
        throw new ConflictException('Dining table changed; refresh and retry');
      }
      if (table.currentOrderId) throw new ConflictException('A table with an active order cannot change status directly');

      const transitions: Record<DiningTableStatus, readonly DiningTableStatus[]> = {
        AVAILABLE: ['RESERVED', 'OUT_OF_SERVICE'],
        RESERVED: ['AVAILABLE', 'OUT_OF_SERVICE'],
        OCCUPIED: [],
        CLEANING: ['AVAILABLE', 'OUT_OF_SERVICE'],
        OUT_OF_SERVICE: ['AVAILABLE'],
      };
      if (!transitions[table.status].includes(target)) {
        throw new ConflictException(`Invalid dining table transition: ${table.status} → ${target}`);
      }

      const changed = await tx.diningTable.updateMany({
        where: { id: table.id, version: table.version, status: table.status, currentOrderId: null },
        data: { status: target, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('Dining table changed concurrently; refresh and retry');

      await this.audit.recordWithClient(tx, context, {
        action: 'DINING_TABLE_STATUS_CHANGED',
        entityType: 'DiningTable',
        entityId: table.id,
        branchId: table.branchId,
        metadata: { from: table.status, to: target },
      });
      return { tableId: table.id, status: target, version: table.version + 1 };
    });
  }

  private requireBranch(context: AuthContext, requestedBranchId?: string): string {
    const branchId = resolveBranchScope(context, requestedBranchId);
    if (!branchId) throw new BadRequestException('branchId is required for tenant-wide users');
    assertBranchAccess(context, branchId);
    return branchId;
  }

  private async requireActiveBranch(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], tenantId: string, branchId: string) {
    const branch = await tx.branch.findFirst({ where: { id: branchId, tenantId, active: true }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found or inactive');
  }
}
