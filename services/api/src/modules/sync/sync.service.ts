import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SyncQueue } from './sync-queue.js';
import { SyncEnvelope, SyncResult, validateSyncEnvelope } from './sync-contract.js';

interface StoredOperation {
  fingerprint: string;
  result: SyncResult;
}

@Injectable()
export class SyncService {
  private readonly queue = new SyncQueue();
  private readonly operations = new Map<string, StoredOperation>();

  submit(envelope: SyncEnvelope): SyncResult {
    validateSyncEnvelope(envelope);

    const fingerprint = createHash('sha256')
      .update(JSON.stringify(envelope))
      .digest('hex');

    const existing = this.operations.get(envelope.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return {
          status: 'CONFLICT',
          operationId: existing.result.operationId,
          reason: 'Idempotency key was reused with a different operation',
        };
      }
      return { status: 'DUPLICATE', operationId: existing.result.operationId };
    }

    const result: SyncResult = {
      status: 'APPLIED',
      operationId: randomUUID(),
    };

    this.operations.set(envelope.idempotencyKey, { fingerprint, result });
    this.queue.enqueue(envelope);
    return result;
  }

  pending(): readonly SyncEnvelope[] {
    return this.queue.pending();
  }

  acknowledge(idempotencyKey: string, result: SyncResult): void {
    this.queue.acknowledge(idempotencyKey, result);
    this.operations.set(idempotencyKey, {
      fingerprint: this.operations.get(idempotencyKey)?.fingerprint ?? '',
      result,
    });
  }
}
