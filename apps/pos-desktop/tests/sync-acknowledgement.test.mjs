import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../../../services/api/src/modules/sync/sync-contract.ts', import.meta.url), 'utf8');
const javascript = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const encoded = Buffer.from(javascript).toString('base64');
const { assertSyncAcknowledgement } = await import(`data:text/javascript;base64,${encoded}`);

test('accepts recognized successful sync acknowledgements', () => {
  for (const status of ['ACCEPTED', 'APPLIED', 'DUPLICATE']) {
    assert.doesNotThrow(() => assertSyncAcknowledgement(200, { status, operationId: 'operation-1' }));
  }
});

test('rejects a successful HTTP response with an empty or malformed body', () => {
  for (const body of [null, undefined, {}, { status: 'APPLIED' }, { status: 'UNKNOWN', operationId: 'operation-1' }]) {
    assert.throws(() => assertSyncAcknowledgement(200, body), /acknowledgement|operation id|unknown acknowledgement/);
  }
});

test('rejects conflict and server rejection acknowledgements', () => {
  assert.throws(
    () => assertSyncAcknowledgement(200, { status: 'CONFLICT', operationId: 'operation-1', reason: 'payload differs' }),
    /Sync conflict: payload differs/,
  );
  assert.throws(
    () => assertSyncAcknowledgement(200, { status: 'REJECTED', operationId: 'operation-1', reason: 'invalid checkout' }),
    /Sync rejected: invalid checkout/,
  );
});

test('rejects non-success HTTP statuses even when the body looks successful', () => {
  assert.throws(
    () => assertSyncAcknowledgement(503, { status: 'APPLIED', operationId: 'operation-1' }),
    /Sync HTTP 503/,
  );
});
