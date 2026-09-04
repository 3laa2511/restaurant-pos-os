import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { SyncEnvelope, SyncResult, validateSyncEnvelope } from './sync-contract.js';

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(context: AuthContext, envelope: SyncEnvelope): Promise<SyncResult> {
    this.assertDeviceScope(context, envelope.deviceId, envelope.branchId);
    validateSyncEnvelope(envelope);

    const requestHash = createHash('sha256')
      .update(JSON.stringify(envelope))
      .digest('hex');

    const existing = await this.prisma.syncOperation.findUnique({
      where: { idempotencyKey: envelope.idempotencyKey },
    });

    if (existing) return this.resultForExisting(existing, requestHash);

    const operationId = randomUUID();
    const result: SyncResult = { status: 'ACCEPTED', operationId };

    try {
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
          result,
          updatedAt: new Date(),
        },
      });
      return result;
    } catch {
      const raced = await this.prisma.syncOperation.findUnique({
        where: { idempotencyKey: envelope.idempotencyKey },
      });
      if (!raced) throw new Error('Sync operation could not be persisted');
      return this.resultForExisting(raced, requestHash);
    }
  }

  async pending(context: AuthContext, limit = 100) {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    return this.prisma.syncOperation.findMany({
      where: {
        status: 'RECEIVED',
        ...(context.branchId ? { branchId: context.branchId } : {}),
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

  private assertDeviceScope(context: AuthContext, deviceId: string, branchId: string): void {
    if (!context.branchId || context.branchId !== branchId) {
      throw new Error('Forbidden: branch access denied');
    }
    if (!context.deviceId || context.deviceId !== deviceId) {
      throw new Error('Forbidden: device access denied');
    }
  }

  private resultForExisting(existing: { operationId: string; requestHash: string; result: unknown }, requestHash: string): SyncResult {
    if (existing.requestHash !== requestHash) {
      return {
        status: 'CONFLICT',
        operationId: existing.operationId,
        reason: 'Idempotency key was reused with a different operation',
      };
    }

    if (existing.result && typeof existing.result === 'object' && 'status' in existing.result) {
      return existing.result as SyncResult;
    }

    return { status: 'DUPLICATE', operationId: existing.operationId };
  }
}
