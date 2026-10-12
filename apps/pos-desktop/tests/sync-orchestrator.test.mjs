import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/pos/sync-orchestrator.ts', import.meta.url), 'utf8');
const javascript = ts.transpile(source, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
});
const encoded = Buffer.from(javascript).toString('base64');
const { SyncOrchestrator } = await import(`data:text/javascript;base64,${encoded}`);

test('overlapping runOnce calls on one orchestrator do not push the same batch twice', async () => {
  let releasePush;
  let pushCount = 0;
  const pushBlocked = new Promise((resolve) => { releasePush = resolve; });
  const item = {
    id: 'sync-1',
    entity_type: 'ORDER',
    entity_id: 'order-1',
    operation: 'CHECKOUT',
    idempotency_key: 'checkout-order-1',
    client_sequence: 1,
    payload: '{}',
    status: 'SYNCING',
    attempts: 0,
    last_error: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  const repository = {
    async getPending() { return [item]; },
    async markSynced() {},
    async markFailed() {},
  };
  const transport = {
    async push() {
      pushCount += 1;
      await pushBlocked;
    },
  };
  const orchestrator = new SyncOrchestrator(repository, transport, { workerId: 'worker-test' });

  const firstRun = orchestrator.runOnce();
  await Promise.resolve();
  const overlappingRun = await orchestrator.runOnce();

  assert.deepEqual(overlappingRun, {
    attempted: 0,
    synced: 0,
    failed: 0,
    failedAttempts: null,
  });
  assert.equal(pushCount, 1);

  releasePush();
  const completed = await firstRun;
  assert.equal(completed.attempted, 1);
  assert.equal(completed.synced, 1);
  assert.equal(pushCount, 1);
});

test('a failed sync is recorded for retry and stops later items in sequence', async () => {
  const items = [
    { id: 'sync-1', entity_type: 'ORDER', entity_id: 'order-1', operation: 'CHECKOUT', idempotency_key: 'key-1', client_sequence: 1, payload: '{}', status: 'SYNCING', attempts: 2, last_error: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    { id: 'sync-2', entity_type: 'ORDER', entity_id: 'order-2', operation: 'CHECKOUT', idempotency_key: 'key-2', client_sequence: 2, payload: '{}', status: 'SYNCING', attempts: 0, last_error: null, created_at: '2026-01-01T00:00:01Z', updated_at: '2026-01-01T00:00:01Z' },
  ];
  const failures = [];
  let pushCount = 0;
  const repository = {
    async getPending() { return items; },
    async markSynced() {},
    async markFailed(id, workerId, message) { failures.push({ id, workerId, message }); },
  };
  const transport = {
    async push() { pushCount += 1; throw new Error('network unavailable'); },
  };
  const orchestrator = new SyncOrchestrator(repository, transport, { workerId: 'worker-retry' });

  const result = await orchestrator.runOnce();

  assert.deepEqual(result, { attempted: 1, synced: 0, failed: 1, failedAttempts: 3 });
  assert.deepEqual(failures, [{ id: 'sync-1', workerId: 'worker-retry', message: 'network unavailable' }]);
  assert.equal(pushCount, 1);
});
