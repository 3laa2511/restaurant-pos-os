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

test('rejects a retry when order items change but the total stays the same', () => {
  const detailedOrder = {
    ...order,
    branchId: 'branch-1',
    deviceId: 'device-1',
    cashierId: 'cashier-1',
    type: 'DINE_IN',
    status: 'DRAFT',
    subtotal: 125,
    discount: 0,
    tax: 0,
    serviceFee: 0,
    deliveryFee: 0,
    createdAt: '2026-10-13T00:00:00.000Z',
    items: [{ productId: 'product-1', quantity: 1, unitPrice: 125, note: null, modifiers: [] }],
  };
  const storedDetailedOrder = { ...detailedOrder, payment };
  assert.doesNotThrow(() => assertExistingCheckoutMatches(
    detailedOrder,
    detailedOrder.id,
    storedDetailedOrder,
    payment,
  ));
  assert.throws(() => assertExistingCheckoutMatches(
    { ...detailedOrder, items: [{ ...detailedOrder.items[0], productId: 'product-2' }] },
    detailedOrder.id,
    storedDetailedOrder,
    payment,
  ), /different order payload/);
});

test('rejects retry when checkout identity changes despite an identical amount', () => {
  const detailedOrder = {
    ...order,
    branchId: 'branch-1',
    deviceId: 'device-1',
    cashierId: 'cashier-1',
    type: 'TAKEAWAY',
    status: 'DRAFT',
    subtotal: 125,
    discount: 0,
    tax: 0,
    serviceFee: 0,
    deliveryFee: 0,
    createdAt: '2026-10-13T00:00:00.000Z',
    items: [{ productId: 'product-1', quantity: 1, unitPrice: 125, note: null, modifiers: [] }],
  };
  const persisted = { ...detailedOrder, payment };
  for (const changed of [
    { ...detailedOrder, branchId: 'branch-2' },
    { ...detailedOrder, deviceId: 'device-2' },
    { ...detailedOrder, cashierId: 'cashier-2' },
  ]) {
    assert.throws(
      () => assertExistingCheckoutMatches(changed, detailedOrder.id, persisted, payment),
      /different order payload/,
    );
  }
});


test('accepts equivalent item snapshots when object key order differs', () => {
  const detailedOrder = {
    ...order,
    branchId: 'branch-1',
    deviceId: 'device-1',
    cashierId: 'cashier-1',
    type: 'TAKEAWAY',
    status: 'DRAFT',
    subtotal: 125,
    discount: 0,
    tax: 0,
    serviceFee: 0,
    deliveryFee: 0,
    createdAt: '2026-10-13T00:00:00.000Z',
    items: [{ productId: 'product-1', quantity: 1, unitPrice: 125, note: null, modifiers: [] }],
  };
  const persisted = { ...detailedOrder, payment };
  const retried = {
    ...detailedOrder,
    items: [{ modifiers: [], note: null, unitPrice: 125, quantity: 1, productId: 'product-1' }],
  };

  assert.doesNotThrow(() => assertExistingCheckoutMatches(
    retried,
    detailedOrder.id,
    persisted,
    payment,
  ));
});
