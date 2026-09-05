import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { validateSplitPayment, type PaymentAllocation } from './split-payment-policy.js';

export interface PersistSplitPaymentInput { orderId: string; shiftId: string; allocations: readonly PaymentAllocation[]; idempotencyKey: string; deviceId: string; clientSequence: number; }
export interface PersistSplitPaymentResult { operationId: string; orderId: string; status: 'PAID'; totalPaid: number; change: number; paymentIds: string[]; }
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const requireText = (value: string, field: string): void => { if (!value.trim()) throw new Error(`${field} is required`); };
const isUniqueConstraintError = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const jsonValue = (value: unknown): ReturnType<typeof JSON.parse> => JSON.parse(JSON.stringify(value));

@Injectable()
export class PaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async settleSplitPayment(context: AuthContext, input: PersistSplitPaymentInput): Promise<PersistSplitPaymentResult> {
    assertPermission(context, PERMISSIONS.PAYMENT_CREATE); requireText(input.orderId, 'Order'); requireText(input.shiftId, 'Shift'); requireText(input.idempotencyKey, 'Idempotency key'); requireText(input.deviceId, 'Device');
    if (!Number.isInteger(input.clientSequence) || input.clientSequence < 0) throw new Error('clientSequence must be a non-negative integer');
    if (context.deviceId !== input.deviceId) throw new Error('Payment device does not match the authenticated device');
    const requestHash = createHash('sha256').update(JSON.stringify({ ...input, allocations: input.allocations })).digest('hex');
    const existing = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return this.existingResult(existing.result, existing.requestHash, requestHash, existing.operationId);
    const operationId = randomUUID();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { id: true, branchId: true, status: true, total: true, version: true } });
        if (!order) throw new Error('Order not found'); assertBranchAccess(context, order.branchId);
        const shift = await tx.shift.findUnique({ where: { id: input.shiftId }, select: { id: true, branchId: true, deviceId: true, status: true } });
        if (!shift) throw new Error('Shift not found'); if (shift.branchId !== order.branchId) throw new Error('Shift does not belong to the order branch'); if (shift.deviceId !== input.deviceId) throw new Error('Shift does not belong to the payment device'); if (shift.status !== 'OPEN') throw new Error('Shift is not open');
        if (order.status !== 'CONFIRMED') throw new Error(`Order must be confirmed before payment: ${order.status}`);
        const validated = validateSplitPayment({ orderId: input.orderId, shiftId: input.shiftId, totalDue: Number(order.total.toString()), allocations: input.allocations });
        const existingPayments = await tx.payment.findMany({ where: { orderId: input.orderId }, select: { id: true } });
        if (existingPayments.length > 0) throw new Error('Order already has payments; use the refund/void flow instead of charging again');

        const cashAllocations = input.allocations.filter((allocation) => allocation.method === 'CASH');
        const cashReceived = money(cashAllocations.reduce((sum, allocation) => sum + (allocation.receivedCash ?? allocation.amount), 0));
        const cashSale = money(cashAllocations.reduce((sum, allocation) => sum + allocation.amount, 0));
        const cashChange = money(Math.max(0, cashReceived - cashSale));
        let drawer: { id: string; branchId: string; deviceId: string; active: boolean } | null = null;
        if (cashAllocations.length > 0) {
          drawer = await tx.cashDrawer.findUnique({ where: { deviceId: input.deviceId }, select: { id: true, branchId: true, deviceId: true, active: true } });
          if (!drawer || !drawer.active || drawer.branchId !== order.branchId) throw new Error('An active cash drawer is required for cash payments');
        }

        const paymentIds: string[] = [];
        for (const [index, allocation] of input.allocations.entries()) {
          const paymentId = randomUUID(); paymentIds.push(paymentId);
          const receivedAmount = allocation.method === 'CASH' ? allocation.receivedCash ?? allocation.amount : null;
          const changeAmount = allocation.method === 'CASH' ? money(Math.max(0, (receivedAmount ?? allocation.amount) - allocation.amount)) : 0;
          await tx.payment.create({ data: { id: paymentId, orderId: input.orderId, shiftId: input.shiftId, amount: allocation.amount.toFixed(2), method: allocation.method, reference: allocation.reference?.trim() || null, receivedAmount: receivedAmount === null ? null : receivedAmount.toFixed(2), changeAmount: changeAmount.toFixed(2), status: 'PAID', idempotencyKey: `${input.idempotencyKey}:payment:${index}` } });
        }

        if (drawer) {
          if (cashSale > 0) await tx.cashDrawerMovement.create({ data: { id: randomUUID(), drawerId: drawer.id, branchId: order.branchId, deviceId: input.deviceId, shiftId: input.shiftId, userId: context.userId, type: 'SALE', direction: 'IN', amount: cashSale.toFixed(2), reason: `Cash sale for order ${order.id}`, sourceType: 'PAYMENT_OPERATION', sourceId: operationId, idempotencyKey: `${input.idempotencyKey}:drawer:sale`, operationId: `${operationId}:sale`, metadata: jsonValue({ orderId: order.id, paymentIds }), occurredAt: new Date() } });
          if (cashChange > 0) await tx.cashDrawerMovement.create({ data: { id: randomUUID(), drawerId: drawer.id, branchId: order.branchId, deviceId: input.deviceId, shiftId: input.shiftId, userId: context.userId, type: 'CASH_CHANGE', direction: 'OUT', amount: cashChange.toFixed(2), reason: `Change for order ${order.id}`, sourceType: 'PAYMENT_OPERATION', sourceId: operationId, idempotencyKey: `${input.idempotencyKey}:drawer:change`, operationId: `${operationId}:change`, metadata: jsonValue({ orderId: order.id, paymentIds }), occurredAt: new Date() } });
        }

        const transition = await tx.order.updateMany({ where: { id: input.orderId, version: order.version, status: 'CONFIRMED' }, data: { status: 'CLOSED', version: { increment: 1 } } });
        if (transition.count !== 1) throw new Error('Order was changed by another operation before payment could be finalized');
        const eventPayload = { operationId, totalPaid: validated.totalAllocated, paymentCount: input.allocations.length, paymentIds, change: validated.change };
        await tx.orderEvent.create({ data: { id: randomUUID(), eventId: randomUUID(), orderId: input.orderId, type: 'ORDER_PAID', actorUserId: context.userId, deviceId: input.deviceId, payload: jsonValue(eventPayload), occurredAt: new Date() } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorUserId: context.userId, branchId: order.branchId, action: 'PAYMENT_SETTLED', entityType: 'ORDER', entityId: input.orderId, metadata: jsonValue(eventPayload) } });
        const result: PersistSplitPaymentResult = { operationId, orderId: input.orderId, status: 'PAID', totalPaid: validated.totalAllocated, change: validated.change, paymentIds };
        await tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: input.deviceId, branchId: order.branchId, operation: 'PAYMENT_SETTLED', entityType: 'ORDER', entityId: input.orderId, idempotencyKey: input.idempotencyKey, clientSequence: input.clientSequence, occurredAt: new Date(), payload: jsonValue({ orderId: input.orderId, shiftId: input.shiftId, allocations: input.allocations, paymentIds }), requestHash, status: 'APPLIED', result: jsonValue(result), updatedAt: new Date() } });
        return result;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) { const winner = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } }); if (winner) return this.existingResult(winner.result, winner.requestHash, requestHash, winner.operationId); }
      throw error;
    }
  }

  private existingResult(result: unknown, storedHash: string, requestHash: string, operationId: string): PersistSplitPaymentResult {
    if (storedHash !== requestHash) throw new Error('Idempotency key was reused with a different payment request');
    if (!result || typeof result !== 'object') throw new Error('Existing payment operation has no recoverable result');
    const value = result as Partial<PersistSplitPaymentResult>;
    if (value.operationId !== operationId || value.status !== 'PAID' || value.orderId === undefined || value.totalPaid === undefined || value.change === undefined || !Array.isArray(value.paymentIds)) throw new Error('Existing payment operation has an invalid result');
    return { operationId, orderId: value.orderId, status: 'PAID', totalPaid: value.totalPaid, change: value.change, paymentIds: value.paymentIds };
  }
}
