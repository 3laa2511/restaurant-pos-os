import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { assertMoneyAmount, assertShiftCanClose, validateOpenShift } from './shift-policy.js';

export interface OpenShiftInput { branchId: string; deviceId: string; openingCash: number; idempotencyKey: string; clientSequence: number; }
export interface CloseShiftInput { shiftId: string; closingCash: number; idempotencyKey: string; clientSequence: number; }
export interface ShiftResult { operationId: string; shiftId: string; status: 'OPEN' | 'CLOSED'; expectedCash?: number; actualCash?: number; variance?: number; }
export interface CurrentShiftResult { shiftId: string; branchId: string; deviceId: string; cashierId: string; status: 'OPEN'; openingCash: number; openedAt: string; }
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const text = (value: string, field: string): void => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); };
const validSequence = (value: number): void => { if (!Number.isInteger(value) || value < 0) throw new Error('clientSequence must be a non-negative integer'); };
const requestHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isUnique = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const isSerializationConflict = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
const runSerializable = async <T>(operation: () => Promise<T>): Promise<T> => { for (let attempt = 1; attempt <= 3; attempt += 1) { try { return await operation(); } catch (error) { if (!isSerializationConflict(error) || attempt === 3) throw error; } } throw new Error('Unreachable transaction retry state'); };

@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async current(context: AuthContext): Promise<CurrentShiftResult | null> {
    if (!context.branchId || !context.deviceId) throw new Error('Authenticated branch and device are required'); assertBranchAccess(context, context.branchId);
    const shift = await this.prisma.shift.findFirst({ where: { branchId: context.branchId, deviceId: context.deviceId, status: 'OPEN' }, select: { id: true, branchId: true, deviceId: true, userId: true, status: true, openingCash: true, openedAt: true } });
    if (!shift) return null; if (shift.userId !== context.userId && !context.permissions.includes(PERMISSIONS.REPORT_VIEW_FINANCIAL)) throw new Error('The active shift belongs to another cashier');
    return { shiftId: shift.id, branchId: shift.branchId, deviceId: shift.deviceId, cashierId: shift.userId, status: 'OPEN', openingCash: Number(shift.openingCash), openedAt: shift.openedAt.toISOString() };
  }

  async open(context: AuthContext, input: OpenShiftInput): Promise<ShiftResult> {
    assertPermission(context, PERMISSIONS.SHIFT_OPEN); text(input.branchId, 'Branch'); text(input.deviceId, 'Device'); text(input.idempotencyKey, 'Idempotency key'); validSequence(input.clientSequence); assertMoneyAmount(input.openingCash, 'Opening cash'); validateOpenShift({ branchId: input.branchId, cashierId: context.userId, deviceId: input.deviceId, openingCash: input.openingCash }); assertBranchAccess(context, input.branchId); if (context.deviceId !== input.deviceId) throw new Error('Shift device does not match the authenticated device');
    const hash = requestHash({ ...input }); const existingOperation = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existingOperation) { if (existingOperation.requestHash !== hash) throw new Error('Idempotency key was reused with a different operation'); if (existingOperation.result) return existingOperation.result as unknown as ShiftResult; }
    const operationId = randomUUID();
    try {
      return await runSerializable(() => this.prisma.$transaction(async (tx) => {
        const branch = await tx.branch.findUnique({ where: { id: input.branchId }, select: { id: true, active: true } }); if (!branch?.active) throw new Error('Branch not found or inactive');
        const device = await tx.device.findUnique({ where: { id: input.deviceId }, select: { id: true, branchId: true, status: true, name: true } }); if (!device || device.branchId !== input.branchId || device.status !== 'ACTIVE') throw new Error('Device is not active in the selected branch');
        const openShift = await tx.shift.findFirst({ where: { status: 'OPEN', OR: [{ deviceId: input.deviceId }, { userId: context.userId }] }, select: { id: true, userId: true, deviceId: true } });
        if (openShift) { if (openShift.deviceId === input.deviceId) throw new Error(`Device already has an open shift (${openShift.id})`); throw new Error(`Cashier already has an open shift (${openShift.id})`); }
        let shift; try { shift = await tx.shift.create({ data: { id: randomUUID(), branchId: input.branchId, userId: context.userId, deviceId: input.deviceId, openingCash: input.openingCash.toFixed(2), status: 'OPEN' } }); } catch (error) { if (isUnique(error)) throw new Error('Cashier or device already has an open shift'); throw error; }
        const drawer = await tx.cashDrawer.upsert({ where: { deviceId: input.deviceId }, update: { active: true }, create: { id: randomUUID(), branchId: input.branchId, deviceId: input.deviceId, name: `${device.name} Cash Drawer`, active: true } });
        await tx.cashDrawerMovement.create({ data: { id: randomUUID(), drawerId: drawer.id, branchId: input.branchId, deviceId: input.deviceId, shiftId: shift.id, userId: context.userId, type: 'OPENING_FLOAT', direction: 'IN', amount: input.openingCash.toFixed(2), reason: `Opening float for shift ${shift.id}`, sourceType: 'SHIFT', sourceId: shift.id, idempotencyKey: `${input.idempotencyKey}:drawer:opening`, operationId: `${operationId}:opening`, metadata: { shiftId: shift.id }, occurredAt: new Date() } });
        await this.audit.recordWithClient(tx, context, { action: 'SHIFT_OPENED', entityType: 'SHIFT', entityId: shift.id, branchId: input.branchId, deviceId: input.deviceId, before: { status: 'NONE', openingCash: 0 }, after: { status: 'OPEN', openingCash: input.openingCash }, metadata: { operationId, drawerId: drawer.id } });
        const result: ShiftResult = { operationId, shiftId: shift.id, status: 'OPEN' };
        await tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: input.deviceId, branchId: input.branchId, operation: 'SHIFT_OPENED', entityType: 'SHIFT', entityId: shift.id, idempotencyKey: input.idempotencyKey, clientSequence: input.clientSequence, occurredAt: new Date(), payload: { shiftId: shift.id, openingCash: input.openingCash, drawerId: drawer.id }, requestHash: hash, status: 'APPLIED', result: result as unknown as object, updatedAt: new Date() } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    } catch (error) { if (isUnique(error)) { const winner = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } }); if (winner) { if (winner.requestHash !== hash) throw new Error('Idempotency key was reused with a different operation'); if (winner.result) return winner.result as unknown as ShiftResult; } } throw error; }
  }

  async close(context: AuthContext, input: CloseShiftInput): Promise<ShiftResult> {
    assertPermission(context, PERMISSIONS.SHIFT_CLOSE); text(input.shiftId, 'Shift'); text(input.idempotencyKey, 'Idempotency key'); validSequence(input.clientSequence); assertMoneyAmount(input.closingCash, 'Closing cash');
    const hash = requestHash({ ...input }); const existingOperation = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existingOperation) { if (existingOperation.requestHash !== hash) throw new Error('Idempotency key was reused with a different operation'); if (existingOperation.result) return existingOperation.result as unknown as ShiftResult; }
    const operationId = randomUUID();
    try {
      return await runSerializable(() => this.prisma.$transaction(async (tx) => {
        const shift = await tx.shift.findUnique({ where: { id: input.shiftId }, select: { id: true, branchId: true, userId: true, deviceId: true, status: true, openingCash: true, openedAt: true } });
        if (!shift) throw new Error('Shift not found'); assertBranchAccess(context, shift.branchId); if (context.userId !== shift.userId && !context.permissions.includes(PERMISSIONS.REPORT_VIEW_FINANCIAL)) throw new Error('Only the shift owner or financial manager can close this shift'); if (context.deviceId && context.deviceId !== shift.deviceId) throw new Error('Shift device does not match the authenticated device');
        assertShiftCanClose({ ...shift, cashierId: shift.userId, openingCash: Number(shift.openingCash) });
        const movements = await tx.cashDrawerMovement.findMany({ where: { shiftId: shift.id }, select: { amount: true, direction: true } }); if (movements.length === 0) throw new Error('Shift has no cash drawer ledger; cannot close safely');
        const expectedCash = money(movements.reduce((total, movement) => total + (movement.direction === 'IN' ? Number(movement.amount) : -Number(movement.amount)), 0)); const actualCash = money(input.closingCash); const variance = money(actualCash - expectedCash);
        const updated = await tx.shift.updateMany({ where: { id: shift.id, status: 'OPEN' }, data: { status: 'CLOSED', closingCash: actualCash.toFixed(2), closedAt: new Date() } }); if (updated.count !== 1) throw new Error('Shift was closed by another operation');
        const result: ShiftResult = { operationId, shiftId: shift.id, status: 'CLOSED', expectedCash, actualCash, variance };
        const after = { status: 'CLOSED', openingCash: Number(shift.openingCash), expectedCash, actualCash, variance };
        await this.audit.recordWithClient(tx, context, { action: 'SHIFT_CLOSED', entityType: 'SHIFT', entityId: shift.id, branchId: shift.branchId, deviceId: shift.deviceId, before: { status: shift.status, openingCash: Number(shift.openingCash) }, after, metadata: { operationId, ledgerMovementCount: movements.length } });
        if (variance !== 0) {
          await this.audit.recordWithClient(tx, context, { action: 'SHIFT_VARIANCE', entityType: 'SHIFT', entityId: shift.id, branchId: shift.branchId, deviceId: shift.deviceId, reason: `Shift cash variance: ${variance.toFixed(2)}`, before: { expectedCash }, after: { actualCash, variance }, metadata: { operationId, ledgerMovementCount: movements.length } });
        }
        await tx.syncOperation.create({ data: { id: randomUUID(), operationId, deviceId: shift.deviceId, branchId: shift.branchId, operation: 'SHIFT_CLOSED', entityType: 'SHIFT', entityId: shift.id, idempotencyKey: input.idempotencyKey, clientSequence: input.clientSequence, occurredAt: new Date(), payload: { shiftId: shift.id, closingCash: actualCash, expectedCash, variance }, requestHash: hash, status: 'APPLIED', result: result as unknown as object, updatedAt: new Date() } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    } catch (error) { if (isUnique(error)) { const winner = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } }); if (winner) { if (winner.requestHash !== hash) throw new Error('Idempotency key was reused with a different operation'); if (winner.result) return winner.result as unknown as ShiftResult; } } throw error; }
  }
}
