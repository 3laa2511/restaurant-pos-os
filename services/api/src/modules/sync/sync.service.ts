import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { SyncEnvelope, SyncResult, validateSyncEnvelope } from './sync-contract.js';

interface CheckoutPayload {
  id: string; orderNumber: string; branchId: string; deviceId: string; cashierId: string;
  type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'; status: 'CONFIRMED';
  items: Array<{ productId: string; nameAr: string; nameEn: string; sku: string; unitPrice: number; quantity: number; note: string | null }>;
  subtotal: number; discount: number; tax: number; serviceFee: number; deliveryFee: number; total: number; createdAt: string;
  payment: { paymentId: string; orderId: string; shiftId: string; method: 'CASH' | 'CARD' | 'WALLET' | 'OTHER'; amount: number; reference?: string | null };
}
function jsonValue(value: unknown): ReturnType<typeof JSON.parse> { return JSON.parse(JSON.stringify(value)); }
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
  money(value.payment.amount, 'payment.amount', false); if (value.payment.method !== 'CASH') text(value.payment.reference, 'payment.reference');
  return value as CheckoutPayload;
}

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(context: AuthContext, envelope: SyncEnvelope): Promise<SyncResult> {
    const tenantId = assertTenantScope(context);
    this.assertDeviceScope(context, envelope.deviceId, envelope.branchId);
    validateSyncEnvelope(envelope);
    const branch = await this.prisma.branch.findFirst({ where: { id: envelope.branchId, tenantId, active: true }, select: { id: true } });
    if (!branch) throw new Error('Forbidden: branch does not belong to the authenticated tenant');
    const requestHash = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
    const existing = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: envelope.idempotencyKey } });
    if (existing) {
      if (existing.branchId !== envelope.branchId) throw new Error('Idempotency key is already in use');
      const owner = await this.prisma.branch.findFirst({ where: { id: existing.branchId, tenantId }, select: { id: true } });
      if (!owner) throw new Error('Idempotency key is already in use');
      return this.resultForExisting(existing, requestHash);
    }
    if (envelope.operation !== 'CHECKOUT' || envelope.entityType !== 'ORDER') return this.rejectUnsupportedOperation(envelope, requestHash);
    const operationId = randomUUID();
    const payload = assertCheckoutPayload(envelope.payload, envelope);
    assertPermission(context, PERMISSIONS.ORDER_CREATE);
    assertPermission(context, PERMISSIONS.PAYMENT_CREATE);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const shift = await tx.shift.findFirst({ where: { id: payload.payment.shiftId, branch: { tenantId } }, select: { id: true, branchId: true, deviceId: true, status: true } });
        if (!shift) throw new Error('Shift not found');
        if (shift.branchId !== envelope.branchId) throw new Error('Shift branch does not match the sync branch');
        if (shift.deviceId !== envelope.deviceId) throw new Error('Shift device does not match the sync device');
        if (shift.status !== 'OPEN') throw new Error('Shift is not open');
        const existingOrder = await tx.order.findFirst({ where: { id: payload.id, branch: { tenantId } }, select: { id: true } });
        if (existingOrder) throw new Error('Order already exists on the server');

        const productIds = [...new Set(payload.items.map((item) => item.productId))];
        const products = await tx.product.findMany({ where: { id: { in: productIds }, tenantId, active: true }, select: { id: true } });
        if (products.length !== productIds.length) throw new Error('Checkout contains unavailable products');
        const subtotal = Number(payload.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2));
        if (subtotal !== payload.subtotal) throw new Error('Checkout subtotal does not match its line items');
        const expectedTotal = Number((payload.subtotal - payload.discount + payload.tax + payload.serviceFee + payload.deliveryFee).toFixed(2));
        if (expectedTotal !== payload.total) throw new Error('Checkout total does not match its pricing breakdown');
        if (payload.payment.amount !== payload.total) throw new Error('Payment amount does not match checkout total');

        await tx.order.create({ data: { id: payload.id, orderNumber: payload.orderNumber, source: 'POS', type: payload.type, status: 'CLOSED', version: 2, branchId: envelope.branchId, createdById: context.userId, total: payload.total.toFixed(2), createdAt: new Date(payload.createdAt) } });
        await tx.orderItem.createMany({ data: payload.items.map((item, index) => ({ id: `${payload.id}:item:${index}`, orderId: payload.id, productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice.toFixed(2), lineTotal: (item.unitPrice * item.quantity).toFixed(2), notes: item.note ?? null })) });
        await tx.payment.create({ data: { id: payload.payment.paymentId, orderId: payload.id, shiftId: payload.payment.shiftId, amount: payload.payment.amount.toFixed(2), method: payload.payment.method, reference: payload.payment.reference?.trim() || null, receivedAmount: payload.payment.method === 'CASH' ? payload.payment.amount.toFixed(2) : null, changeAmount: '0.00', status: 'PAID', idempotencyKey: `${envelope.idempotencyKey}:payment` } });

        if (payload.payment.method === 'CASH') {
          const drawer = await tx.cashDrawer.findFirst({ where: { deviceId: envelope.deviceId, branch: { tenantId } }, select: { id: true, branchId: true, active: true } });
          if (!drawer || !drawer.active || drawer.branchId !== envelope.branchId) throw new Error('An active cash drawer is required for cash checkout sync');
          await tx.cashDrawerMovement.create({ data: { id: randomUUID(), drawerId: drawer.id, branchId: envelope.branchId, deviceId: envelope.deviceId, shiftId: payload.payment.shiftId, userId: context.userId, type: 'SALE', direction: 'IN', amount: payload.payment.amount.toFixed(2), reason: `Synced cash sale for order ${payload.id}`, sourceType: 'SYNC_CHECKOUT', sourceId: operationId, idempotencyKey: `${envelope.idempotencyKey}:drawer:sale`, operationId: `${operationId}:sale`, metadata: jsonValue({ orderId: payload.id, paymentId: payload.payment.paymentId, clientSequence: envelope.clientSequence }), occurredAt: new Date(envelope.occurredAt) } });
        }

        const eventPayload = { operationId, source: 'OFFLINE_SYNC', paymentId: payload.payment.paymentId, total: payload.total };
        await tx.orderEvent.create({ data: { id: randomUUID(), eventId: randomUUID(), orderId: payload.id, type: 'ORDER_SYNCED_AND_PAID', actorUserId: context.userId, deviceId: envelope.deviceId, payload: jsonValue(eventPayload), occurredAt: new Date(envelope.occurredAt) } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorUserId: context.userId, branchId: envelope.branchId, action: 'OFFLINE_CHECKOUT_APPLIED', entityType: 'ORDER', entityId: payload.id, metadata: jsonValue({ operationId, clientSequence: envelope.clientSequence, idempotencyKey: envelope.idempotencyKey }) } });
        const applied: SyncResult = { status: 'APPLIED', operationId };
        await tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: envelope.deviceId, branchId: envelope.branchId, operation: envelope.operation, entityType: envelope.entityType, entityId: envelope.entityId, idempotencyKey: envelope.idempotencyKey, clientSequence: envelope.clientSequence, occurredAt: new Date(envelope.occurredAt), payload: jsonValue(envelope.payload), requestHash, status: 'APPLIED', result: jsonValue(applied), updatedAt: new Date() } });
        return applied;
      });
    } catch (error) {
      const raced = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: envelope.idempotencyKey } });
      if (raced) {
        const owner = await this.prisma.branch.findFirst({ where: { id: raced.branchId, tenantId }, select: { id: true } });
        if (!owner || raced.branchId !== envelope.branchId) throw new Error('Idempotency key is already in use');
        return this.resultForExisting(raced, requestHash);
      }
      throw error;
    }
  }

  async pending(context: AuthContext, limit = 100) {
    const tenantId = assertTenantScope(context);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const branchIds = context.branchId
      ? [context.branchId]
      : (await this.prisma.branch.findMany({
          where: { tenantId, active: true },
          select: { id: true },
        })).map((branch) => branch.id);

    return this.prisma.syncOperation.findMany({
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
    });
  }
  private async rejectUnsupportedOperation(envelope: SyncEnvelope, requestHash: string): Promise<SyncResult> {
    const operationId = randomUUID();
    const result: SyncResult = { status: 'REJECTED', operationId, reason: 'Unsupported sync operation; completed POS checkouts must use CHECKOUT' };
    await this.prisma.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: envelope.deviceId, branchId: envelope.branchId, operation: envelope.operation, entityType: envelope.entityType, entityId: envelope.entityId, idempotencyKey: envelope.idempotencyKey, clientSequence: envelope.clientSequence, occurredAt: new Date(envelope.occurredAt), payload: envelope.payload, requestHash, status: 'REJECTED', result, updatedAt: new Date() } });
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
