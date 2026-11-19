import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCashChange, validatePayment } from '../src/index.mjs';

const cashPayment = {
  orderId: 'order-1',
  shiftId: 'shift-1',
  method: 'CASH',
  amount: 10,
};

test('validates a positive cash payment', () => {
  assert.doesNotThrow(() => validatePayment(cashPayment));
});

test('requires a reference for non-cash payments', () => {
  assert.throws(() => validatePayment({ ...cashPayment, method: 'CARD' }), /reference is required/);
  assert.doesNotThrow(() => validatePayment({ ...cashPayment, method: 'CARD', reference: 'txn-1' }));
});

test('rejects invalid money precision and non-positive payment amount', () => {
  assert.throws(() => validatePayment({ ...cashPayment, amount: 0 }), /Payment amount must be positive/);
  assert.throws(() => validatePayment({ ...cashPayment, amount: 1.005 }), /at most 2 decimal places/);
});

test('validates cash received amount and prevents underpayment', () => {
  assert.doesNotThrow(() => validatePayment({ ...cashPayment, receivedCash: 20 }));
  assert.throws(() => validatePayment({ ...cashPayment, receivedCash: 9 }), /Insufficient cash received/);
  assert.throws(() => validatePayment({ ...cashPayment, receivedCash: 10.001 }), /at most 2 decimal places/);
  assert.throws(() => validatePayment({ ...cashPayment, method: 'CARD', reference: 'txn-1', receivedCash: 20 }), /only valid for cash payments/);
});

test('calculates cash change in currency precision', () => {
  assert.equal(calculateCashChange(12.5, 20), 7.5);
  assert.throws(() => calculateCashChange(12.5, 10), /Insufficient cash received/);
});
