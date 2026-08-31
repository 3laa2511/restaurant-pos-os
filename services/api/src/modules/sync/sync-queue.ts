import type { SyncEnvelope, SyncResult } from './sync-contract.js';

export class SyncQueue {
  private readonly queue: SyncEnvelope[] = [];
  private readonly processed = new Map<string, SyncResult>();

  enqueue(operation: SyncEnvelope): void {
    if (this.processed.has(operation.idempotencyKey)) return;
    if (this.queue.some((item) => item.idempotencyKey === operation.idempotencyKey)) return;
    this.queue.push(operation);
  }

  pending(): readonly SyncEnvelope[] {
    return [...this.queue];
  }

  acknowledge(idempotencyKey: string, result: SyncResult): void {
    this.processed.set(idempotencyKey, result);
    const index = this.queue.findIndex((item) => item.idempotencyKey === idempotencyKey);
    if (index >= 0) this.queue.splice(index, 1);
  }

  resultFor(idempotencyKey: string): SyncResult | undefined {
    return this.processed.get(idempotencyKey);
  }
}
