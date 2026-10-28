import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { test } from 'node:test';

const sourceDirectory = new URL('../src/pos/', import.meta.url);
const sourceText = (name) => readFileSync(new URL(name, sourceDirectory), 'utf8');

async function loadOrchestrator() {
  const directory = mkdtempSync(join(tmpdir(), 'pos-sync-orchestrator-'));
  const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  writeFileSync(join(directory, 'sync-contract.mjs'), compile(sourceText('sync-contract.ts')));
  const contract = await import(pathToFileURL(join(directory, 'sync-contract.mjs')).href);
  const orchestrator = compile(sourceText('sync-orchestrator.ts')).replaceAll('./sync-contract.js', './sync-contract.mjs');
  writeFileSync(join(directory, 'sync-orchestrator.mjs'), orchestrator);
  const loaded = await import(pathToFileURL(join(directory, 'sync-orchestrator.mjs')).href);
  return { ...loaded, contract, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

const item = {
  id: 'queue-1',
  entity_type: 'ORDER',
  entity_id: 'order-1',
  operation: 'CREATE',
  idempotency_key: 'idem-1',
  client_sequence: 1,
  payload: '{}',
  status: 'SYNCING',
  attempts: 0,
  last_error: null,
  created_at: '2026-10-28T00:00:00.000Z',
  updated_at: '2026-10-28T00:00:00.000Z',
};

test('orchestrator releases the item on authentication failure without consuming a retry', async () => {
  const loaded = await loadOrchestrator();
  try {
    const calls = [];
    const repository = {
      getPending: async () => [item],
      markSynced: async (...args) => calls.push(['synced', ...args]),
      markFailed: async (...args) => calls.push(['failed', ...args]),
      releaseForAuthentication: async (...args) => calls.push(['released', ...args]),
    };
    const transport = {
      push: async () => { throw new loaded.contract.SyncAuthenticationRequiredError('session expired'); },
    };
    const orchestrator = new loaded.SyncOrchestrator(repository, transport, { workerId: 'worker-test' });

    const result = await orchestrator.runOnce();

    assert.deepEqual(result, {
      attempted: 1,
      synced: 0,
      failed: 0,
      failedAttempts: null,
      authenticationRequired: true,
    });
    assert.deepEqual(calls, [['released', 'queue-1', 'worker-test', 'session expired']]);
  } finally {
    loaded.cleanup();
  }
});

test('ordinary sync errors still follow the bounded retry failure path', async () => {
  const loaded = await loadOrchestrator();
  try {
    const calls = [];
    const repository = {
      getPending: async () => [item],
      markSynced: async (...args) => calls.push(['synced', ...args]),
      markFailed: async (...args) => calls.push(['failed', ...args]),
      releaseForAuthentication: async (...args) => calls.push(['released', ...args]),
    };
    const transport = { push: async () => { throw new Error('Sync HTTP 500'); } };
    const orchestrator = new loaded.SyncOrchestrator(repository, transport, { workerId: 'worker-test' });

    const result = await orchestrator.runOnce();

    assert.deepEqual(result, {
      attempted: 1,
      synced: 0,
      failed: 1,
      failedAttempts: 1,
      authenticationRequired: false,
    });
    assert.deepEqual(calls, [['failed', 'queue-1', 'worker-test', 'Sync HTTP 500']]);
  } finally {
    loaded.cleanup();
  }
});
