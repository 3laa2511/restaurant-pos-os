import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { setRlsContext, withRlsContext } from '../../database/rls-context.js';
import { assertBranchAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { AuditService } from '../audit/audit.service.js';
import { paymentStatusAfterAdjustment, validateRefund, type PaymentAdjustmentType } from './payment-refund-policy.js';

export interface PaymentAdjustmentInput {
  paymentId: string;
  shiftId: string;
  amount: number;
  reason: string;
  type: PaymentAdjustmentType;
  reference?: string | null;
  idempotencyKey: string;
  deviceId: string;
  clientSequence: number;
}

export interface PaymentAdjustmentResult {
  operationId: string;
  paymentId: string;
  orderId: string;
  type: PaymentAdjustmentType;
  amount: number;
  paymentStatus: 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOIDED';
  orderStatus: string;
}

function cents(value: number): number { return Math.round((value + Number.EPSILON) * 100); }
function money(value: number): number { return cents(value) / 100; }
function requireText(value: string, field: string): void { if (!value.trim()) throw new Error(`${field} is required`); }
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === 'P2002'
    : typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002';
}
function isSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}
function jsonValue(value: unknown): ReturnType<typeof JSON.parse> { return JSON.parse(JSON.stringify(value)); }

@Injectable()
export class RefundService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly accounting: AccountingService) {}

  async adjustPayment(context: AuthContext, input: PaymentAdjustmentInput): Promise<PaymentAdjustmentResult> {
    assertPermission(context, input.type === 'VOID' ? PERMISSIONS.PAYMENT_VOID : PERMISSIONS.PAYMENT_REFUND);
    requireText(input.paymentId, 'Payment');
    requireText(input.shiftId, 'Shift');
    requireText(input.reason, 'Refund reason');
    requireText(input.idempotencyKey, 'Idempotency key');
    requireText(input.deviceId, 'Device');
    if (!Number.isInteger(input.clientSequence) || input.clientSequence < 0) throw new Error('clientSequence must be a non-negative integer');

    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = await withRlsContext(this.prisma, context, (tx) => tx.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } }));
    if (existing) return this.existingResult(existing.result, existing.requestHash, requestHash, existing.operationId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const operationId = randomUUID();
      try {
        return await this.prisma.$transaction(async (tx) => {
          await setRlsContext(tx, context);
          const payment = await tx.payment.findUnique({
          where: { id: input.paymentId },
          select: { id: true, orderId: true, shiftId: true, amount: true, method: true, status: true, order: { select: { id: true, branchId: true, status: true } } },
        });
        if (!payment) throw new Error('Payment not found');
        assertBranchAccess(context, payment.order.branchId);
        if (payment.shiftId !== input.shiftId) throw new Error('Adjustment shift does not match the payment shift');
        if (payment.status !== 'PAID' && payment.status !== 'PARTIALLY_REFUNDED') throw new Error(`Payment cannot be adjusted from status ${payment.status}`);
        if (input.type === 'VOID' && payment.status !== 'PAID') throw new Error('A partially refunded payment cannot be voided');
        if (payment.order.status === 'CANCELLED' || payment.order.status === 'VOIDED') throw new Error(`Order cannot be financially adjusted from status ${payment.order.status}`);

        const before = {
          payment: { id: payment.id, amount: money(Number(payment.amount.toString())), status: payment.status, method: payment.method },
          order: { id: payment.order.id, status: payment.order.status },
        };
        const shift = await tx.shift.findUnique({ where: { id: input.shiftId }, select: { id: true, branchId: true, deviceId: true, status: true } });
        if (!shift) throw new Error('Shift not found');
        if (shift.branchId !== payment.order.branchId) throw new Error('Shift does not belong to the payment branch');
        if (shift.deviceId !== input.deviceId) throw new Error('Adjustment device does not match the shift device');
        if (shift.status !== 'OPEN') throw new Error('Shift is not open');

        const adjustments = await tx.paymentAdjustment.findMany({ where: { paymentId: payment.id }, select: { amount: true } });
        const alreadyRefunded = money(adjustments.reduce((total, adjustment) => total + Number(adjustment.amount.toString()), 0));
        const paymentAmount = money(Number(payment.amount.toString()));
        validateRefund({ paymentAmount, alreadyRefunded, requestedAmount: input.amount, type: input.type, reason: input.reason });

        const nextPaymentStatus = paymentStatusAfterAdjustment(paymentAmount, alreadyRefunded, input.amount, input.type);
        const adjustmentId = randomUUID();
        await tx.paymentAdjustment.create({
          data: { id: adjustmentId, paymentId: payment.id, orderId: payment.orderId, shiftId: input.shiftId, type: input.type, amount: input.amount.toFixed(2), reason: input.reason.trim(), reference: input.reference?.trim() || null, actorUserId: context.userId, deviceId: context.deviceId ?? input.deviceId, idempotencyKey: `${input.idempotencyKey}:adjustment`, operationId },
        });
        await tx.payment.update({ where: { id: payment.id }, data: { status: nextPaymentStatus } });

        if (payment.method === 'CASH') {
          const drawer = await tx.cashDrawer.findUnique({ where: { deviceId: shift.deviceId }, select: { id: true, branchId: true, active: true } });
          if (!drawer || !drawer.active || drawer.branchId !== payment.order.branchId) throw new Error('An active cash drawer is required for cash refunds');
          await tx.cashDrawerMovement.create({ data: { id: randomUUID(), drawerId: drawer.id, branchId: payment.order.branchId, deviceId: shift.deviceId, shiftId: shift.id, userId: context.userId, type: 'REFUND', direction: 'OUT', amount: input.amount.toFixed(2), reason: `${input.type === 'VOID' ? 'Cash void' : 'Cash refund'} for order ${payment.orderId}`, sourceType: 'PAYMENT_ADJUSTMENT', sourceId: adjustmentId, idempotencyKey: `${input.idempotencyKey}:drawer:refund`, operationId: `${operationId}:refund`, metadata: jsonValue({ orderId: payment.orderId, paymentId: payment.id, adjustmentId, adjustmentType: input.type }), occurredAt: new Date() } });
        }

        let orderStatus = payment.order.status;
        if (nextPaymentStatus === 'REFUNDED' || nextPaymentStatus === 'VOIDED') {
          const payments = await tx.payment.findMany({ where: { orderId: payment.orderId }, select: { amount: true, status: true, adjustments: { select: { amount: true } } } });
          const totalRemainingCents = payments.reduce((total, currentPayment) => {
            const paidCents = cents(Number(currentPayment.amount.toString()));
            const adjustedCents = currentPayment.adjustments.reduce((sum, adjustment) => sum + cents(Number(adjustment.amount.toString())), 0);
            return total + Math.max(0, paidCents - adjustedCents);
          }, 0);
          if (totalRemainingCents === 0) {
            orderStatus = 'REFUNDED';
            await tx.order.update({ where: { id: payment.orderId }, data: { status: 'REFUNDED', version: { increment: 1 } } });
          }
        }

        const eventType = input.type === 'VOID' ? 'PAYMENT_VOIDED' : 'PAYMENT_REFUNDED';
        const eventPayload = { operationId, adjustmentId, paymentId: payment.id, type: input.type, amount: input.amount, reason: input.reason.trim(), reference: input.reference?.trim() || null, paymentStatus: nextPaymentStatus, orderStatus };
        await tx.orderEvent.create({ data: { id: randomUUID(), eventId: randomUUID(), orderId: payment.orderId, type: eventType, actorUserId: context.userId, deviceId: context.deviceId ?? input.deviceId, payload: jsonValue(eventPayload), occurredAt: new Date() } });
        await this.accounting.postPaymentAdjustment(tx, context, { adjustmentId, branchId: payment.order.branchId, amount: input.amount, method: payment.method, type: input.type });
        const after = { payment: { id: payment.id, amount: money(Number(payment.amount.toString())), status: nextPaymentStatus }, order: { id: payment.orderId, status: orderStatus } };
        await this.audit.recordWithClient(tx, context, { action: eventType, entityType: 'PAYMENT', entityId: payment.id, branchId: payment.order.branchId, deviceId: context.deviceId ?? input.deviceId, reason: input.reason, before, after, metadata: { operationId, adjustmentId, type: input.type, amount: input.amount } });

        const result: PaymentAdjustmentResult = { operationId, paymentId: payment.id, orderId: payment.orderId, type: input.type, amount: input.amount, paymentStatus: nextPaymentStatus, orderStatus };
        await tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: input.deviceId, branchId: payment.order.branchId, operation: input.type === 'VOID' ? 'PAYMENT_VOIDED' : 'PAYMENT_REFUNDED', entityType: 'PAYMENT', entityId: payment.id, idempotencyKey: input.idempotencyKey, clientSequence: input.clientSequence, occurredAt: new Date(), payload: jsonValue(input), requestHash, status: 'APPLIED', result: jsonValue(result), updatedAt: new Date() } });
          return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const winner = await withRlsContext(this.prisma, context, (tx) => tx.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } }));
          if (winner) return this.existingResult(winner.result, winner.requestHash, requestHash, winner.operationId);
        }
        if (!isSerializationConflict(error) || attempt === 2) throw error;
      }
    }
    throw new Error('Payment adjustment could not be committed safely');
  }

  async refundPayment(context: AuthContext, input: Omit<PaymentAdjustmentInput, 'type'>): Promise<PaymentAdjustmentResult> { return this.adjustPayment(context, { ...input, type: 'REFUND' }); }
  async voidPayment(context: AuthContext, input: Omit<PaymentAdjustmentInput, 'type'>): Promise<PaymentAdjustmentResult> { return this.adjustPayment(context, { ...input, type: 'VOID' }); }

  private existingResult(result: unknown, storedHash: string, requestHash: string, operationId: string): PaymentAdjustmentResult {
    if (storedHash !== requestHash) throw new Error('Idempotency key was reused with a different payment adjustment request');
    if (!result || typeof result !== 'object') throw new Error('Existing payment adjustment has no recoverable result');
    const value = result as Partial<PaymentAdjustmentResult>;
    if (value.operationId !== operationId || value.paymentId === undefined || value.orderId === undefined || value.type === undefined || value.amount === undefined || value.paymentStatus === undefined || value.orderStatus === undefined) throw new Error('Existing payment adjustment has an invalid result');
    return { operationId, paymentId: value.paymentId, orderId: value.orderId, type: value.type, amount: value.amount, paymentStatus: value.paymentStatus, orderStatus: value.orderStatus };
  }
}
