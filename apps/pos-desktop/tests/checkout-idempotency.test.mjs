import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/pos/checkout-idempotency.ts', import.meta.url), 'utf8');
const javascript = ts.transpile(source, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
});
const encoded = Buffer.from(javascript).toString('base64');
const { assertExistingCheckoutMatches } = await import(`data:text/javascript;base64,${encoded}`);

const order = { id: 'order-1', total: 125, orderNumber: 'ORD-001' };
const payment = {
  paymentId: 'payment-1',
  orderId: 'order-1',
  shiftId: 'shift-1',
  method: 'CASH',
  amount: 125,
  reference: null,
};
const stored = { ...order, payment };

test('accepts an exact retry of an already persisted completed checkout', () => {
  assert.doesNotThrow(() => assertExistingCheckoutMatches(order, 'order-1', stored, payment));
});

test('rejects reusing the idempotency key for another order or changed order payload', () => {
  assert.throws(
    () => assertExistingCheckoutMatches({ ...order, id: 'order-2' }, 'order-1', stored, payment),
    /different order/,
  );
  assert.throws(
    () => assertExistingCheckoutMatches({ ...order, total: 126 }, 'order-1', stored, payment),
    /different order payload/,
  );
});

test('rejects changed payment id, shift, method, amount, or reference on retry', () => {
  const changedPayments = [
    { ...payment, paymentId: 'payment-2' },
    { ...payment, shiftId: 'shift-2' },
    { ...payment, method: 'CARD' },
    { ...payment, amount: 124 },
    { ...payment, reference: 'terminal-ref-1' },
  ];
  for (const changed of changedPayments) {
    assert.throws(
      () => assertExistingCheckoutMatches(order, 'order-1', stored, changed),
      /different payment details/,
    );
  }
});

test('rejects a completed-checkout retry when the stored outbox payload has no payment', () => {
  assert.throws(
    () => assertExistingCheckoutMatches(order, 'order-1', order, payment),
    /different payment details/,
  );
});
