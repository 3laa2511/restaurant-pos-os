import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { assertShiftCanClose, validateOpenShift } from './shift-policy.js';

export interface OpenShiftInput {
  branchId: string;
  deviceId: string;
  openingCash: number;
  idempotencyKey: string;
  clientSequence: number;
}

export interface CloseShiftInput {
  shiftId: string;
  closingCash: number;
  idempotencyKey: string;
  clientSequence: number;
}

export interface ShiftResult {
  operationId: string;
  shiftId: string;
  status: 'OPEN' | 'CLOSED';
  expectedCash?: number;
  actualCash?: number;
  variance?: number;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const text = (value: string, field: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
};
const validSequence = (value: number) => {
  if (!Number.isInteger(value) || value < 0) throw new Error('clientSequence must be a non-negative integer');
};
const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService) {}

  async open(context: AuthContext, input: OpenShiftInput): Promise<ShiftResult> {
    assertPermission(context, PERMISSIONS.SHIFT_OPEN);
    text(input.branchId, 'Branch');
    text(input.deviceId, 'Device');
    text(input.idempotencyKey, 'Idempotency key');
    validSequence(input.clientSequence);
    validateOpenShift({ branchId: input.branchId, cashierId: context.userId, deviceId: input.deviceId, openingCash: input.openingCash });
    assertBranchAccess(context, input.branchId);
    if (context.deviceId !== input.deviceId) throw new Error('Shift device does not match the authenticated device');

    const existingOperation = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existingOperation?.result) return existingOperation.result as ShiftResult;

    const operationId = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const branch = await tx.branch.findUnique({ where: { id: input.branchId }, select: { id: true, active: true } });
        if (!branch?.active) throw new Error('Branch not found or inactive');
        const device = await tx.device.findUnique({ where: { id: input.deviceId }, select: { id: true, branchId: true, status: true } });
        if (!device || device.branchId !== input.branchId || device.status !== 'ACTIVE') throw new Error('Device is not active in the selected branch');

        const openShift = await tx.shift.findFirst({ where: { branchId: input.branchId, status: 'OPEN' }, select: { id: true, userId: true, deviceId: true } });
        if (openShift) throw new Error(`Branch already has an open shift (${openShift.id})`);

        const shift = await tx.shift.create({ data: { id: randomUUID(), branchId: input.branchId, userId: context.userId, deviceId: input.deviceId, openingCash: input.openingCash.toFixed(2), status: 'OPEN' } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorUserId: context.userId, branchId: input.branchId, action: 'SHIFT_OPENED', entityType: 'SHIFT', entityId: shift.id, metadata: { operationId, openingCash: input.openingCash, deviceId: input.deviceId } } });
        const result: ShiftResult = { operationId, shiftId: shift.id, status: 'OPEN' };
        await tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: input.deviceId, branchId: input.branchId, operation: 'SHIFT_OPENED', entityType: 'SHIFT', entityId: shift.id, idempotencyKey: input.idempotencyKey, clientSequence: input.clientSequence, occurredAt: new Date(), payload: { shiftId: shift.id, openingCash: input.openingCash }, requestHash: input.idempotencyKey, status: 'APPLIED', result, updatedAt: new Date() } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isUnique(error)) {
        const winner = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (winner?.result) return winner.result as ShiftResult;
      }
      throw error;
    }
  }

  async close(context: AuthContext, input: CloseShiftInput): Promise<ShiftResult> {
    assertPermission(context, PERMISSIONS.SHIFT_CLOSE);
    text(input.shiftId, 'Shift');
    text(input.idempotencyKey, 'Idempotency key');
    validSequence(input.clientSequence);
    if (!Number.isFinite(input.closingCash) || input.closingCash < 0) throw new Error('Closing cash must be non-negative');

    const existingOperation = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existingOperation?.result) return existingOperation.result as ShiftResult;
    const operationId = randomUUID();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const shift = await tx.shift.findUnique({ where: { id: input.shiftId }, select: { id: true, branchId: true, userId: true, deviceId: true, status: true, openingCash: true } });
        if (!shift) throw new Error('Shift not found');
        assertBranchAccess(context, shift.branchId);
        if (context.userId !== shift.userId && !context.permissions.includes(PERMISSIONS.REPORT_VIEW_FINANCIAL)) throw new Error('Only the shift owner or financial manager can close this shift');
        if (context.deviceId && context.deviceId !== shift.deviceId) throw new Error('Shift device does not match the authenticated device');
        assertShiftCanClose({ ...shift, cashierId: shift.userId, openingCash: Number(shift.openingCash), openedAt: new Date() });

        const payments = await tx.payment.findMany({ where: { shiftId: shift.id }, select: { amount: true, method: true, adjustments: { select: { amount: true, type: true } } } });
        let cashNet = 0;
        for (const payment of payments) {
          if (payment.method !== 'CASH') continue;
          cashNet += Number(payment.amount);
          for (const adjustment of payment.adjustments) cashNet -= Number(adjustment.amount);
        }
        const expectedCash = money(Number(shift.openingCash) + cashNet);
        const actualCash = money(input.closingCash);
        const variance = money(actualCash - expectedCash);

        const updated = await tx.shift.updateMany({ where: { id: shift.id, status: 'OPEN' }, data: { status: 'CLOSED', closingCash: actualCash.toFixed(2), closedAt: new Date() } });
        if (updated.count !== 1) throw new Error('Shift was closed by another operation');
        const result: ShiftResult = { operationId, shiftId: shift.id, status: 'CLOSED', expectedCash, actualCash, variance };
        await tx.auditLog.create({ data: { id: randomUUID(), actorUserId: context.userId, branchId: shift.branchId, action: 'SHIFT_CLOSED', entityType: 'SHIFT', entityId: shift.id, metadata: { operationId, expectedCash, actualCash, variance } } });
        await tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: shift.deviceId, branchId: shift.branchId, operation: 'SHIFT_CLOSED', entityType: 'SHIFT', entityId: shift.id, idempotencyKey: input.idempotencyKey, clientSequence: input.clientSequence, occurredAt: new Date(), payload: { shiftId: shift.id, closingCash: actualCash, expectedCash, variance }, requestHash: input.idempotencyKey, status: 'APPLIED', result, updatedAt: new Date() } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isUnique(error)) {
        const winner = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (winner?.result) return winner.result as ShiftResult;
      }
      throw error;
    }
  }
}
