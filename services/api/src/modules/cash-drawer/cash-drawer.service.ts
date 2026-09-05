import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { assertMoneyAmount } from '../shifts/shift-policy.js';

export type CashDrawerMovementType = 'OPENING_FLOAT' | 'SALE' | 'CASH_CHANGE' | 'REFUND' | 'PAY_IN' | 'PAY_OUT' | 'ADJUSTMENT';
export type CashDrawerDirection = 'IN' | 'OUT';
export interface CreateCashDrawerInput { branchId: string; deviceId: string; name: string; }
export interface RecordCashMovementInput { drawerId: string; shiftId: string; deviceId: string; type: CashDrawerMovementType; amount: number; reason: string; idempotencyKey: string; clientSequence: number; direction?: CashDrawerDirection; sourceType?: string; sourceId?: string; }
export interface CashDrawerBalance { drawerId: string; branchId: string; deviceId: string; shiftId: string; balance: number; }
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const text = (value: string, field: string): void => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); };
const isUnique = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function directionFor(type: CashDrawerMovementType, requested?: CashDrawerDirection): CashDrawerDirection { if (type === 'OPENING_FLOAT' || type === 'SALE' || type === 'PAY_IN') return 'IN'; if (type === 'CASH_CHANGE' || type === 'REFUND' || type === 'PAY_OUT') return 'OUT'; if (!requested) throw new Error('Adjustment direction is required'); return requested; }

@Injectable()
export class CashDrawerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(context: AuthContext, input: CreateCashDrawerInput) {
    assertPermission(context, PERMISSIONS.CASH_DRAWER_MANAGE); text(input.branchId, 'Branch'); text(input.deviceId, 'Device'); text(input.name, 'Drawer name'); assertBranchAccess(context, input.branchId);
    if (context.deviceId !== input.deviceId) throw new Error('Cash drawer device does not match the authenticated device');
    const device = await this.prisma.device.findUnique({ where: { id: input.deviceId }, select: { id: true, branchId: true, status: true } });
    if (!device || device.branchId !== input.branchId || device.status !== 'ACTIVE') throw new Error('Device is not active in the selected branch');
    try { return await this.prisma.cashDrawer.create({ data: { id: randomUUID(), branchId: input.branchId, deviceId: input.deviceId, name: input.name.trim() } }); }
    catch (error) { if (isUnique(error)) throw new Error('A cash drawer already exists for this device'); throw error; }
  }

  async getBalance(context: AuthContext, drawerId: string, shiftId: string, deviceId: string): Promise<CashDrawerBalance> {
    assertPermission(context, PERMISSIONS.CASH_DRAWER_VIEW); text(drawerId, 'Drawer'); text(shiftId, 'Shift'); text(deviceId, 'Device'); assertBranchAccess(context, context.branchId ?? '');
    if (context.deviceId !== deviceId) throw new Error('Cash drawer device does not match the authenticated device');
    const drawer = await this.prisma.cashDrawer.findUnique({ where: { id: drawerId }, select: { id: true, branchId: true, deviceId: true, active: true } });
    if (!drawer || !drawer.active) throw new Error('Cash drawer not found or inactive'); assertBranchAccess(context, drawer.branchId); if (drawer.deviceId !== deviceId) throw new Error('Cash drawer does not belong to the selected device');
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId }, select: { id: true, branchId: true, deviceId: true, status: true } });
    if (!shift) throw new Error('Shift not found'); if (shift.branchId !== drawer.branchId || shift.deviceId !== drawer.deviceId) throw new Error('Shift does not belong to the cash drawer');
    const movements = await this.prisma.cashDrawerMovement.findMany({ where: { drawerId, shiftId }, select: { amount: true, direction: true } });
    const balance = money(movements.reduce((total, movement) => total + (movement.direction === 'IN' ? Number(movement.amount) : -Number(movement.amount)), 0));
    return { drawerId: drawer.id, branchId: drawer.branchId, deviceId: drawer.deviceId, shiftId: shift.id, balance };
  }

  async recordMovement(context: AuthContext, input: RecordCashMovementInput) {
    assertPermission(context, PERMISSIONS.CASH_DRAWER_MANAGE); text(input.drawerId, 'Drawer'); text(input.shiftId, 'Shift'); text(input.deviceId, 'Device'); text(input.reason, 'Reason'); text(input.idempotencyKey, 'Idempotency key');
    if (!Number.isInteger(input.clientSequence) || input.clientSequence < 0) throw new Error('clientSequence must be a non-negative integer'); assertMoneyAmount(input.amount, 'Cash movement amount'); if (input.amount === 0) throw new Error('Cash movement amount must be greater than zero');
    const direction = directionFor(input.type, input.direction);
    if (input.type === 'SALE' || input.type === 'CASH_CHANGE' || input.type === 'REFUND') throw new Error('System cash movements must be created by the payment/refund flow');
    if (input.type === 'OPENING_FLOAT' && direction !== 'IN') throw new Error('Opening float must be an IN movement'); if (input.type === 'PAY_OUT' && direction !== 'OUT') throw new Error('Pay-out must be an OUT movement');
    const requestHash = hash({ ...input, direction }); const existing = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) { if (existing.requestHash !== requestHash) throw new Error('Idempotency key was reused with a different cash movement'); if (existing.result) return existing.result as unknown as { operationId: string; movementId: string; balance: number }; }
    if (context.deviceId !== input.deviceId) throw new Error('Cash drawer device does not match the authenticated device');
    const operationId = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const drawer = await tx.cashDrawer.findUnique({ where: { id: input.drawerId }, select: { id: true, branchId: true, deviceId: true, active: true } });
        if (!drawer || !drawer.active) throw new Error('Cash drawer not found or inactive'); assertBranchAccess(context, drawer.branchId); if (drawer.deviceId !== input.deviceId) throw new Error('Cash drawer does not belong to the selected device');
        const shift = await tx.shift.findUnique({ where: { id: input.shiftId }, select: { id: true, branchId: true, deviceId: true, status: true } });
        if (!shift) throw new Error('Shift not found'); if (shift.status !== 'OPEN') throw new Error('Shift is not open'); if (shift.branchId !== drawer.branchId || shift.deviceId !== drawer.deviceId) throw new Error('Shift does not belong to the cash drawer');
        const movement = await tx.cashDrawerMovement.create({ data: { id: randomUUID(), drawerId: drawer.id, branchId: drawer.branchId, deviceId: drawer.deviceId, shiftId: shift.id, userId: context.userId, type: input.type, direction, amount: input.amount.toFixed(2), reason: input.reason.trim(), sourceType: input.sourceType?.trim() || null, sourceId: input.sourceId?.trim() || null, idempotencyKey: input.idempotencyKey, operationId, metadata: { direction }, occurredAt: new Date() } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorUserId: context.userId, branchId: drawer.branchId, action: 'CASH_DRAWER_MOVEMENT', entityType: 'CASH_DRAWER_MOVEMENT', entityId: movement.id, metadata: { operationId, drawerId: drawer.id, shiftId: shift.id, type: input.type, direction, amount: input.amount, reason: input.reason.trim() } } });
        const movements = await tx.cashDrawerMovement.findMany({ where: { drawerId: drawer.id, shiftId: shift.id }, select: { amount: true, direction: true } });
        const balance = money(movements.reduce((total, item) => total + (item.direction === 'IN' ? Number(item.amount) : -Number(item.amount)), 0));
        const result = { operationId, movementId: movement.id, balance };
        await tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: drawer.deviceId, branchId: drawer.branchId, operation: 'CASH_DRAWER_MOVEMENT', entityType: 'CASH_DRAWER_MOVEMENT', entityId: movement.id, idempotencyKey: input.idempotencyKey, clientSequence: input.clientSequence, occurredAt: new Date(), payload: { drawerId: drawer.id, shiftId: shift.id, type: input.type, direction, amount: input.amount }, requestHash, status: 'APPLIED', result, updatedAt: new Date() } });
        return result;
      });
    } catch (error) {
      if (isUnique(error)) { const winner = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } }); if (winner) { if (winner.requestHash !== requestHash) throw new Error('Idempotency key was reused with a different cash movement'); if (winner.result) return winner.result as unknown as { operationId: string; movementId: string; balance: number }; } }
      throw error;
    }
  }
}
