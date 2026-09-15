import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertKitchenStationAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { SyncEnvelope, SyncResult } from '../sync/sync-contract.js';
import { validateSyncEnvelope } from '../sync/sync-contract.js';
import { KitchenService } from './kitchen.service.js';
import type { KitchenTicketStatus } from './kitchen-ticket.policy.js';

const STATUSES: readonly KitchenTicketStatus[] = [
  'SENT_TO_KITCHEN',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
];

interface KitchenTicketSyncPayload {
  target: KitchenTicketStatus;
  expectedVersion: number;
  reason?: string | null;
}

function parsePayload(payload: Record<string, unknown>): KitchenTicketSyncPayload {
  const target = payload.target;
  const expectedVersion = payload.expectedVersion;
  if (typeof target !== 'string' || !STATUSES.includes(target as KitchenTicketStatus)) {
    throw new Error('Invalid kitchen ticket target');
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('Kitchen ticket expectedVersion must be a positive integer');
  }
  const reason = payload.reason;
  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    throw new Error('Kitchen ticket reason must be a string or null');
  }
  if (target === 'CANCELLED' && !String(reason ?? '').trim()) {
    throw new Error('Cancellation reason is required');
  }
  return { target: target as KitchenTicketStatus, expectedVersion, reason: typeof reason === 'string' ? reason.trim() || null : null };
}

@Injectable()
export class KitchenSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kitchen: KitchenService,
  ) {}

  async submit(context: AuthContext, envelope: SyncEnvelope): Promise<SyncResult> {
    validateSyncEnvelope(envelope);
    assertPermission(context, PERMISSIONS.KITCHEN_TICKET_MANAGE);
    assertBranchAccess(context, envelope.branchId);
    if (!context.deviceId || context.deviceId !== envelope.deviceId) {
      throw new Error('Forbidden: device access denied');
    }
    if (envelope.operation !== 'UPDATE' || envelope.entityType !== 'KITCHEN_TICKET') {
      return { status: 'REJECTED', operationId: randomUUID(), reason: 'Unsupported kitchen ticket sync operation' };
    }

    const payload = parsePayload(envelope.payload);
    const requestHash = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
    const existing = await this.prisma.syncOperation.findUnique({ where: { idempotencyKey: envelope.idempotencyKey } });
    if (existing) return this.resultForExisting(existing, requestHash, context, envelope, payload);

    const operationId = randomUUID();
    await this.prisma.syncOperation.create({
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
        payload: envelope.payload,
        requestHash,
        status: 'RECEIVED',
        updatedAt: new Date(),
      },
    });

    try {
      await this.kitchen.transitionTicket(
        context,
        envelope.entityId,
        payload.target,
        payload.reason ?? undefined,
        payload.expectedVersion,
      );
      const applied: SyncResult = { status: 'APPLIED', operationId };
      await this.prisma.syncOperation.update({ where: { operationId }, data: { status: 'APPLIED', result: applied, updatedAt: new Date() } });
      return applied;
    } catch (error) {
      const current = await this.prisma.kitchenTicket.findUnique({ where: { id: envelope.entityId }, select: { branchId: true, station: true, status: true, version: true } });
      if (current && current.branchId === envelope.branchId && current.version === payload.expectedVersion + 1 && current.status === payload.target) {
        assertKitchenStationAccess(context, current.station);
        const recovered: SyncResult = { status: 'APPLIED', operationId };
        await this.prisma.syncOperation.update({ where: { operationId }, data: { status: 'APPLIED', result: recovered, updatedAt: new Date() } });
        return recovered;
      }
      const message = error instanceof Error ? error.message : 'Kitchen ticket sync failed';
      const rejected: SyncResult = { status: 'CONFLICT', operationId, reason: message };
      await this.prisma.syncOperation.update({ where: { operationId }, data: { status: 'REJECTED', result: rejected, updatedAt: new Date() } });
      return rejected;
    }
  }

  private async resultForExisting(
    existing: { operationId: string; requestHash: string; result: unknown; status: string },
    requestHash: string,
    context: AuthContext,
    envelope: SyncEnvelope,
    payload: KitchenTicketSyncPayload,
  ): Promise<SyncResult> {
    if (existing.requestHash !== requestHash) {
      return { status: 'CONFLICT', operationId: existing.operationId, reason: 'Idempotency key was reused with a different operation' };
    }
    if (existing.result && typeof existing.result === 'object' && 'status' in existing.result) {
      return existing.result as SyncResult;
    }
    if (existing.status === 'RECEIVED') {
      const current = await this.prisma.kitchenTicket.findUnique({ where: { id: envelope.entityId }, select: { branchId: true, station: true, status: true, version: true } });
      if (current && current.branchId === envelope.branchId && current.version === payload.expectedVersion + 1 && current.status === payload.target) {
        assertKitchenStationAccess(context, current.station);
        const recovered: SyncResult = { status: 'APPLIED', operationId: existing.operationId };
        await this.prisma.syncOperation.update({ where: { operationId: existing.operationId }, data: { status: 'APPLIED', result: recovered, updatedAt: new Date() } });
        return recovered;
      }
      return { status: 'CONFLICT', operationId: existing.operationId, reason: 'Kitchen ticket sync is unresolved; reload the ticket before retrying' };
    }
    return { status: 'DUPLICATE', operationId: existing.operationId };
  }
}
