import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { setRlsContext, withRlsContext } from '../../database/rls-context.js';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { SyncEnvelope, SyncResult, validateSyncEnvelope } from './sync-contract.js';
import { assertCheckoutPrices } from './checkout-price-policy.js';
import { buildCheckoutKitchenTickets } from './checkout-kitchen-routing.js';

interface CheckoutPayload {
  id: string; orderNumber: string; branchId: string; deviceId: string; cashierId: string;
  type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'; status: 'CONFIRMED';
  items: Array<{ productId: string; nameAr: string; nameEn: string; sku: string; unitPrice: number; quantity: number; note: string | null }>;
  subtotal: number; discount: number; tax: number; serviceFee: number; deliveryFee: number; total: number; createdAt: string;
  payment: { paymentId: string; orderId: string; shiftId: string; method: 'CASH' | 'CARD' | 'WALLET' | 'OTHER'; amount: number; reference?: string | null };
}
function jsonValue(value: unknown): ReturnType<typeof JSON.parse> { return JSON.parse(JSON.stringify(value)); }
function canonicalJson(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function money(value: unknown, field: string, allowZero = true): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) throw new Error(`${field} must be a valid non-negative amount`); const rounded = Math.round((value + Number.EPSILON) * 100) / 100; if (Math.abs(value - rounded) > 1e-9) throw new Error(`${field} must have at most 2 decimal places`); return rounded; }
function text(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function assertCheckoutPayload(payload: unknown, envelope: SyncEnvelope): CheckoutPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Checkout payload must be an object');
  const value = payload as Partial<CheckoutPayload>;
  if (value.id !== envelope.entityId) throw new Error('Checkout payload order id does not match the sync entity');
  if (value.branchId !== envelope.branchId) throw new Error('Checkout payload branch does not match the authenticated branch');
  if (value.deviceId !== envelope.deviceId) throw new Error('Checkout payload device does not match the authenticated device');
  text(value.orderNumber, 'orderNumber'); text(value.cashierId, 'cashierId');
  if (!['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(value.type ?? '')) throw new Error('Invalid order type');
  if (!Array.isArray(value.items) || value.items.length === 0) throw new Error('Checkout must contain at least one item');
  for (const item of value.items) { text(item.productId, 'item.productId'); if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Item quantity must be a positive integer'); money(item.unitPrice, 'item.unitPrice', false); }
  money(value.subtotal, 'subtotal'); money(value.discount, 'discount'); money(value.tax, 'tax'); money(value.serviceFee, 'serviceFee'); money(value.deliveryFee, 'deliveryFee'); money(value.total, 'total'); text(value.createdAt, 'createdAt');
  if (!value.payment || value.payment.orderId !== value.id) throw new Error('Payment order does not match checkout order');
  text(value.payment.paymentId, 'payment.paymentId'); text(value.payment.shiftId, 'payment.shiftId');
  if (!['CASH', 'CARD', 'WALLET', 'OTHER'].includes(value.payment.method ?? '')) throw new Error('Invalid payment method');
  if (value.payment.method === 'CARD') throw new Error('Card checkout cannot be synced until a verified payment processor integration is configured');
  money(value.payment.amount, 'payment.amount', false); if (value.payment.method !== 'CASH') text(value.payment.reference, 'payment.reference');
  return value as CheckoutPayload;
}

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService) {}

  async submit(context: AuthContext, envelope: SyncEnvelope): Promise<SyncResult> {
    const tenantId = assertTenantScope(context);
    validateSyncEnvelope(envelope);
    this.assertDeviceScope(context, envelope.deviceId, envelope.branchId);
    const requestHash = createHash('sha256').update(canonicalJson(envelope)).digest('hex');
    const preflight = await withRlsContext(this.prisma, context, async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: envelope.branchId, tenantId, active: true }, select: { id: true } });
      if (!branch) throw new Error('Forbidden: branch does not belong to the authenticated tenant');
      const existing = await tx.syncOperation.findUnique({ where: { idempotencyKey: envelope.idempotencyKey } });
      if (!existing) return null;
      if (existing.branchId !== envelope.branchId) throw new Error('Idempotency key is already in use');
      const owner = await tx.branch.findFirst({ where: { id: existing.branchId, tenantId }, select: { id: true } });
      if (!owner) throw new Error('Idempotency key is already in use');
      return existing;
    });
    if (preflight) return this.resultForExisting(preflight, requestHash);
    if (envelope.operation === 'SHIFT' && envelope.entityType === 'SHIFT') {
      return this.applyShiftOperation(context, envelope, requestHash);
    }
    if (envelope.operation !== 'CHECKOUT' || envelope.entityType !== 'ORDER') {
      assertPermission(context, PERMISSIONS.ORDER_CREATE);
      return this.rejectUnsupportedOperation(context, envelope, requestHash);
    }
    const operationId = randomUUID();
    const payload = assertCheckoutPayload(envelope.payload, envelope);
    assertPermission(context, PERMISSIONS.ORDER_CREATE);
    assertPermission(context, PERMISSIONS.PAYMENT_CREATE);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await setRlsContext(tx, context);
        const shift = await tx.shift.findFirst({ where: { id: payload.payment.shiftId, branch: { tenantId } }, select: { id: true, branchId: true, deviceId: true, status: true } });
        if (!shift) throw new Error('Shift not found');
        if (shift.branchId !== envelope.branchId) throw new Error('Shift branch does not match the sync branch');
        if (shift.deviceId !== envelope.deviceId) throw new Error('Shift device does not match the sync device');
        if (shift.status !== 'OPEN') throw new Error('Shift is not open');
        const existingOrder = await tx.order.findFirst({ where: { id: payload.id, branch: { tenantId } }, select: { id: true } });
        if (existingOrder) throw new Error('Order already exists on the server');
        const cycle = await tx.businessCycle.findFirst({ where: { tenantId, branchId: envelope.branchId, status: 'OPEN' }, select: { id: true } });
        if (!cycle) throw new Error('An open business cycle is required for checkout sync');

        const productIds = [...new Set(payload.items.map((item) => item.productId))];
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, tenantId, active: true },
          select: {
            id: true,
            name: true,
            kitchenStation: true,
            price: true,
            branchProducts: {
              where: { branchId: envelope.branchId },
              select: { enabled: true, available: true, priceOverride: true },
            },
          },
        });
        if (products.length !== productIds.length) throw new Error('Checkout contains unavailable products');
        assertCheckoutPrices(payload.items, products);
        const subtotal = Number(payload.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2));
        if (subtotal !== payload.subtotal) throw new Error('Checkout subtotal does not match its line items');
        const expectedTotal = Number((payload.subtotal - payload.discount + payload.tax + payload.serviceFee + payload.deliveryFee).toFixed(2));
        if (expectedTotal !== payload.total) throw new Error('Checkout total does not match its pricing breakdown');
        if (payload.payment.amount !== payload.total) throw new Error('Payment amount does not match checkout total');

        await tx.order.create({ data: { id: payload.id, orderNumber: payload.orderNumber, source: 'POS', type: payload.type, status: 'CLOSED', version: 2, branchId: envelope.branchId, cycleId: cycle.id, createdById: context.userId, total: payload.total.toFixed(2), createdAt: new Date(payload.createdAt) } });
        await tx.orderItem.createMany({ data: payload.items.map((item, index) => ({ id: `${payload.id}:item:${index}`, orderId: payload.id, productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice.toFixed(2), lineTotal: (item.unitPrice * item.quantity).toFixed(2), notes: item.note ?? null })) });

        // A completed cashier checkout must atomically create immutable kitchen
        // ticket snapshots from server-owned product routing, not client labels.
        const kitchenDrafts = buildCheckoutKitchenTickets(payload.id, payload.items, products);
        for (const draft of kitchenDrafts) {
          await tx.kitchenTicket.create({
            data: {
              id: randomUUID(),
              orderId: payload.id,
              branchId: envelope.branchId,
              station: draft.station,
              status: 'SENT_TO_KITCHEN',
              version: 1,
              sequence: 1,
              sentAt: new Date(envelope.occurredAt),
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
          });
        }

        await tx.payment.create({ data: { id: payload.payment.paymentId, orderId: payload.id, shiftId: payload.payment.shiftId, amount: payload.payment.amount.toFixed(2), method: payload.payment.method, reference: payload.payment.reference?.trim() || null, receivedAmount: payload.payment.method === 'CASH' ? payload.payment.amount.toFixed(2) : null, changeAmount: '0.00', status: 'PAID', idempotencyKey: `${envelope.idempotencyKey}:payment` } });

        if (payload.payment.method === 'CASH') {
          const drawer = await tx.cashDrawer.findFirst({ where: { deviceId: envelope.deviceId, branch: { tenantId } }, select: { id: true, branchId: true, active: true } });
          if (!drawer || !drawer.active || drawer.branchId !== envelope.branchId) throw new Error('An active cash drawer is required for cash checkout sync');
          await tx.cashDrawerMovement.create({ data: { id: randomUUID(), drawerId: drawer.id, branchId: envelope.branchId, deviceId: envelope.deviceId, shiftId: payload.payment.shiftId, userId: context.userId, type: 'SALE', direction: 'IN', amount: payload.payment.amount.toFixed(2), reason: `Synced cash sale for order ${payload.id}`, sourceType: 'SYNC_CHECKOUT', sourceId: operationId, idempotencyKey: `${envelope.idempotencyKey}:drawer:sale`, operationId: `${operationId}:sale`, metadata: jsonValue({ orderId: payload.id, paymentId: payload.payment.paymentId, clientSequence: envelope.clientSequence }), occurredAt: new Date(envelope.occurredAt) } });
        }

        await this.accounting.postSale(tx, context, { orderId: payload.id, branchId: envelope.branchId, amount: payload.total, payments: [{ method: payload.payment.method, amount: payload.payment.amount }] });

        const eventPayload = { operationId, source: 'OFFLINE_SYNC', paymentId: payload.payment.paymentId, total: payload.total, kitchenTicketCount: kitchenDrafts.length, kitchenStations: kitchenDrafts.map((ticket) => ticket.station) };
        await tx.orderEvent.create({ data: { id: randomUUID(), eventId: randomUUID(), orderId: payload.id, type: 'ORDER_SYNCED_AND_PAID', actorUserId: context.userId, deviceId: envelope.deviceId, payload: jsonValue(eventPayload), occurredAt: new Date(envelope.occurredAt) } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorUserId: context.userId, branchId: envelope.branchId, action: 'OFFLINE_CHECKOUT_APPLIED', entityType: 'ORDER', entityId: payload.id, metadata: jsonValue({ operationId, clientSequence: envelope.clientSequence, idempotencyKey: envelope.idempotencyKey, kitchenTicketCount: kitchenDrafts.length, kitchenStations: kitchenDrafts.map((ticket) => ticket.station) }) } });
        const applied: SyncResult = { status: 'APPLIED', operationId };
        await tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: envelope.deviceId, branchId: envelope.branchId, operation: envelope.operation, entityType: envelope.entityType, entityId: envelope.entityId, idempotencyKey: envelope.idempotencyKey, clientSequence: envelope.clientSequence, occurredAt: new Date(envelope.occurredAt), payload: jsonValue(envelope.payload), requestHash, status: 'APPLIED', result: jsonValue(applied), updatedAt: new Date() } });
        return applied;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const raced = await withRlsContext(this.prisma, context, async (tx) => {
        const found = await tx.syncOperation.findUnique({ where: { idempotencyKey: envelope.idempotencyKey } });
        if (!found) return null;
        const owner = await tx.branch.findFirst({ where: { id: found.branchId, tenantId }, select: { id: true } });
        if (!owner || found.branchId !== envelope.branchId) throw new Error('Idempotency key is already in use');
        return found;
      });
      if (raced) return this.resultForExisting(raced, requestHash);
      throw error;
    }
  }

  private async applyShiftOperation(context: AuthContext, envelope: SyncEnvelope, requestHash: string): Promise<SyncResult> {
    const tenantId = assertTenantScope(context);
    const action = envelope.payload.action;
    const shiftId = text(envelope.payload.shiftId, 'shiftId');
    if (shiftId !== envelope.entityId) throw new Error('Shift payload id does not match the sync entity');
    const operationId = randomUUID();

    if (action === 'OPEN') {
      assertPermission(context, PERMISSIONS.SHIFT_OPEN);
      const openingCash = money(envelope.payload.openingCash, 'openingCash');
      return this.prisma.$transaction(async (tx) => {
        await setRlsContext(tx, context);
        const branch = await tx.branch.findFirst({
          where: { id: envelope.branchId, tenantId, active: true },
          select: { id: true },
        });
        if (!branch) throw new Error('Branch not found or inactive');
        const device = await tx.device.findFirst({
          where: { id: envelope.deviceId, branch: { tenantId } },
          select: { id: true, branchId: true, status: true, name: true },
        });
        if (!device || device.branchId !== envelope.branchId || device.status !== 'ACTIVE') {
          throw new Error('Device is not active in the selected branch');
        }
        const openShift = await tx.shift.findFirst({
          where: {
            branch: { tenantId },
            status: 'OPEN',
            OR: [{ deviceId: envelope.deviceId }, { userId: context.userId }],
          },
          select: { id: true, userId: true, deviceId: true },
        });
        if (openShift) throw new Error('Cashier or device already has an open shift');

        const shift = await tx.shift.create({
          data: {
            id: shiftId,
            branchId: envelope.branchId,
            userId: context.userId,
            deviceId: envelope.deviceId,
            openingCash: openingCash.toFixed(2),
            status: 'OPEN',
            openedAt: new Date(envelope.occurredAt),
          },
        });
        const drawer = await tx.cashDrawer.upsert({
          where: { deviceId: envelope.deviceId },
          update: { active: true },
          create: {
            id: randomUUID(),
            branchId: envelope.branchId,
            deviceId: envelope.deviceId,
            name: `${device.name} Cash Drawer`,
            active: true,
          },
        });
        if (drawer.branchId !== envelope.branchId) throw new Error('Cash drawer belongs to another branch');
        await tx.cashDrawerMovement.create({
          data: {
            id: randomUUID(),
            drawerId: drawer.id,
            branchId: envelope.branchId,
            deviceId: envelope.deviceId,
            shiftId: shift.id,
            userId: context.userId,
            type: 'OPENING_FLOAT',
            direction: 'IN',
            amount: openingCash.toFixed(2),
            reason: `Opening float for shift ${shift.id}`,
            sourceType: 'SHIFT',
            sourceId: shift.id,
            idempotencyKey: `${envelope.idempotencyKey}:drawer:opening`,
            operationId: `${operationId}:opening`,
            metadata: { shiftId: shift.id },
            occurredAt: new Date(envelope.occurredAt),
          },
        });
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            actorUserId: context.userId,
            branchId: envelope.branchId,
            action: 'SHIFT_OPENED',
            entityType: 'SHIFT',
            entityId: shift.id,
            metadata: { operationId, drawerId: drawer.id, openingCash },
          },
        });
        const result: SyncResult = { status: 'APPLIED', operationId };
        await tx.syncOperation.create({
          data: {
            id: randomUUID(),
            operationId,
            deviceId: envelope.deviceId,
            branchId: envelope.branchId,
            operation: envelope.operation,
            entityType: envelope.entityType,
            entityId: envelope.entityId,
            idempotencyKey: envelope.idempotencyKey,
            clientSequence: envelope.clientSequence,
            occurredAt: new Date(envelope.occurredAt),
            payload: jsonValue(envelope.payload),
            requestHash,
            status: 'APPLIED',
            result: jsonValue(result),
            updatedAt: new Date(),
          },
        });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    if (action === 'CLOSE') {
      assertPermission(context, PERMISSIONS.SHIFT_CLOSE);
      const closingCash = money(envelope.payload.closingCash, 'closingCash');
      return this.prisma.$transaction(async (tx) => {
        await setRlsContext(tx, context);
        const shift = await tx.shift.findFirst({
          where: { id: shiftId, branch: { tenantId } },
          select: { id: true, branchId: true, userId: true, deviceId: true, status: true, openingCash: true },
        });
        if (!shift) throw new Error('Shift not found');
        assertBranchAccess(context, shift.branchId);
        if (shift.deviceId !== envelope.deviceId) throw new Error('Shift device does not match the sync device');
        if (shift.userId !== context.userId && !context.permissions.includes(PERMISSIONS.REPORT_VIEW_FINANCIAL)) {
          throw new Error('Only the shift owner or financial manager can close this shift');
        }
        if (shift.status !== 'OPEN') throw new Error('Shift is already closed');
        const movements = await tx.cashDrawerMovement.findMany({
          where: { shiftId: shift.id, branch: { tenantId } },
          select: { amount: true, direction: true },
        });
        if (movements.length === 0) throw new Error('Shift has no cash drawer ledger; cannot close safely');
        const expectedCash = Number(movements.reduce((total, movement) =>
          total + (movement.direction === 'IN' ? Number(movement.amount) : -Number(movement.amount)), 0).toFixed(2));
        const variance = Number((closingCash - expectedCash).toFixed(2));
        const updated = await tx.shift.updateMany({
          where: { id: shift.id, status: 'OPEN', branch: { tenantId } },
          data: { status: 'CLOSED', closingCash: closingCash.toFixed(2), closedAt: new Date(envelope.occurredAt) },
        });
        if (updated.count !== 1) throw new Error('Shift was closed by another operation');
        const after = { status: 'CLOSED', openingCash: Number(shift.openingCash), expectedCash, actualCash: closingCash, variance };
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            actorUserId: context.userId,
            branchId: shift.branchId,
            action: 'SHIFT_CLOSED',
            entityType: 'SHIFT',
            entityId: shift.id,
            metadata: { operationId, ...after, ledgerMovementCount: movements.length },
          },
        });
        if (variance !== 0) {
          await tx.auditLog.create({
            data: {
              id: randomUUID(),
              actorUserId: context.userId,
              branchId: shift.branchId,
              action: 'SHIFT_VARIANCE',
              entityType: 'SHIFT',
              entityId: shift.id,
              metadata: { operationId, expectedCash, actualCash: closingCash, variance, ledgerMovementCount: movements.length },
            },
          });
        }
        const result: SyncResult = { status: 'APPLIED', operationId };
        await tx.syncOperation.create({
          data: {
            id: randomUUID(),
            operationId,
            deviceId: envelope.deviceId,
            branchId: shift.branchId,
            operation: envelope.operation,
            entityType: envelope.entityType,
            entityId: envelope.entityId,
            idempotencyKey: envelope.idempotencyKey,
            clientSequence: envelope.clientSequence,
            occurredAt: new Date(envelope.occurredAt),
            payload: jsonValue(envelope.payload),
            requestHash,
            status: 'APPLIED',
            result: jsonValue(result),
            updatedAt: new Date(),
          },
        });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    throw new Error('Unsupported shift sync action');
  }

  async pending(context: AuthContext, limit = 100) {
    const tenantId = assertTenantScope(context);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const branchIds = context.branchId
      ? [context.branchId]
      : (await withRlsContext(this.prisma, context, (tx) => tx.branch.findMany({
          where: { tenantId, active: true },
          select: { id: true },
        }))).map((branch) => branch.id);

    return withRlsContext(this.prisma, context, (tx) => tx.syncOperation.findMany({
      where: {
        status: 'RECEIVED',
        branchId: { in: branchIds },
      },
      orderBy: [{ clientSequence: 'asc' }, { createdAt: 'asc' }],
      take: boundedLimit,
      select: {
        operationId: true,
        deviceId: true,
        branchId: true,
        operation: true,
        entityType: true,
        entityId: true,
        idempotencyKey: true,
        clientSequence: true,
        occurredAt: true,
        payload: true,
        status: true,
      },
    }));
  }
  private async rejectUnsupportedOperation(context: AuthContext, envelope: SyncEnvelope, requestHash: string): Promise<SyncResult> {
    const operationId = randomUUID();
    const result: SyncResult = { status: 'REJECTED', operationId, reason: 'Unsupported sync operation; completed POS checkouts must use CHECKOUT' };
    await withRlsContext(this.prisma, context, (tx) => tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: envelope.deviceId, branchId: envelope.branchId, operation: envelope.operation, entityType: envelope.entityType, entityId: envelope.entityId, idempotencyKey: envelope.idempotencyKey, clientSequence: envelope.clientSequence, occurredAt: new Date(envelope.occurredAt), payload: envelope.payload, requestHash, status: 'REJECTED', result, updatedAt: new Date() } }));
    return result;
  }

  private assertDeviceScope(context: AuthContext, deviceId: string, branchId: string): void {
    assertBranchAccess(context, branchId);
    if (!context.deviceId || context.deviceId !== deviceId) throw new Error('Forbidden: device access denied');
  }

  private resultForExisting(existing: { operationId: string; requestHash: string; result: unknown }, requestHash: string): SyncResult {
    if (existing.requestHash !== requestHash) return { status: 'CONFLICT', operationId: existing.operationId, reason: 'Idempotency key was reused with a different operation' };
    if (existing.result && typeof existing.result === 'object' && 'status' in existing.result) return existing.result as SyncResult;
    return { status: 'DUPLICATE', operationId: existing.operationId };
  }
}
