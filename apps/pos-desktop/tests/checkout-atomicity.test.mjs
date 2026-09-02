import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const schema = await readFile(new URL('../src/pos/sqlite-schema.sql', import.meta.url), 'utf8');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function seedShift(db) {
  db.prepare(`
    INSERT INTO shifts (id, branch_id, device_id, cashier_id, status, opened_at, closed_at)
    VALUES (?, ?, ?, ?, 'OPEN', ?, NULL)
  `).run('shift-1', 'branch-1', 'device-1', 'cashier-1', '2026-09-02T08:00:00.000Z');
}

function checkoutStatements({ orderId, orderNumber, idempotencyKey, paymentId, printJobId, now = '2026-09-02T08:01:00.000Z' }) {
  return [
    {
      sql: `INSERT INTO orders (
        id, order_number, branch_id, device_id, cashier_id, type, status,
        subtotal, discount, delivery_fee, total, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [orderId, orderNumber, 'branch-1', 'device-1', 'cashier-1', 'TAKEAWAY', 'CONFIRMED', 100, 0, 0, 100, now, now],
    },
    {
      sql: `INSERT INTO order_items (
        id, order_id, product_id, name_ar, name_en, sku, unit_price, quantity, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [`${orderId}:item:0`, orderId, 'product-1', 'منتج', 'Product', 'SKU-1', 100, 1, null],
    },
    {
      sql: `INSERT INTO payments (id, order_id, shift_id, method, amount, reference, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [paymentId, orderId, 'shift-1', 'CASH', 100, null, now],
    },
    {
      sql: `INSERT INTO print_jobs (id, order_id, station, payload, status, attempts, last_error, created_at)
            VALUES (?, ?, ?, ?, 'PENDING', 0, NULL, ?)`,
      params: [printJobId, orderId, 'CASHIER', '{}', now],
    },
    {
      sql: `INSERT INTO sync_queue (
        id, entity_type, entity_id, operation, idempotency_key, client_sequence,
        payload, status, attempts, last_error, locked_by, locked_until, created_at, updated_at
      ) VALUES (?, 'ORDER', ?, 'CREATE', ?, 1, ?, 'PENDING', 0, NULL, NULL, NULL, ?, ?)`,
      params: [`${orderId}:sync`, orderId, idempotencyKey, JSON.stringify({ id: orderId }), now, now],
    },
  ];
}

function executeTransaction(db, statements) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of statements) {
      db.prepare(statement.sql).run(...statement.params);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

test('completed checkout commits order, payment, print job, and outbox together', () => {
  const db = createDatabase();
  seedShift(db);

  executeTransaction(db, checkoutStatements({
    orderId: 'order-1',
    orderNumber: 'ORD-0001',
    idempotencyKey: 'checkout-1',
    paymentId: 'payment-1',
    printJobId: 'print-1',
  }));

  assert.equal(count(db, 'orders'), 1);
  assert.equal(count(db, 'order_items'), 1);
  assert.equal(count(db, 'payments'), 1);
  assert.equal(count(db, 'print_jobs'), 1);
  assert.equal(count(db, 'sync_queue'), 1);
  assert.equal(db.prepare('SELECT entity_id FROM sync_queue WHERE idempotency_key = ?').get('checkout-1').entity_id, 'order-1');
  db.close();
});

test('later print-job constraint failure rolls back the entire checkout', () => {
  const db = createDatabase();
  seedShift(db);
  const statements = checkoutStatements({
    orderId: 'order-2',
    orderNumber: 'ORD-0002',
    idempotencyKey: 'checkout-2',
    paymentId: 'payment-2',
    printJobId: 'print-2',
  });
  statements[3].params[1] = 'missing-order';

  assert.throws(() => executeTransaction(db, statements), /FOREIGN KEY/);
  assert.equal(count(db, 'orders'), 0);
  assert.equal(count(db, 'order_items'), 0);
  assert.equal(count(db, 'payments'), 0);
  assert.equal(count(db, 'print_jobs'), 0);
  assert.equal(count(db, 'sync_queue'), 0);
  db.close();
});

test('payment foreign-key failure rolls back order and all downstream state', () => {
  const db = createDatabase();
  seedShift(db);
  const statements = checkoutStatements({
    orderId: 'order-3',
    orderNumber: 'ORD-0003',
    idempotencyKey: 'checkout-3',
    paymentId: 'payment-3',
    printJobId: 'print-3',
  });
  statements[2].params[2] = 'missing-shift';

  assert.throws(() => executeTransaction(db, statements), /FOREIGN KEY/);
  assert.equal(count(db, 'orders'), 0);
  assert.equal(count(db, 'order_items'), 0);
  assert.equal(count(db, 'payments'), 0);
  assert.equal(count(db, 'print_jobs'), 0);
  assert.equal(count(db, 'sync_queue'), 0);
  db.close();
});

test('idempotency key is database-enforced and cannot be reused for another order', () => {
  const db = createDatabase();
  seedShift(db);

  executeTransaction(db, checkoutStatements({
    orderId: 'order-4',
    orderNumber: 'ORD-0004',
    idempotencyKey: 'checkout-4',
    paymentId: 'payment-4',
    printJobId: 'print-4',
  }));

  const second = checkoutStatements({
    orderId: 'order-5',
    orderNumber: 'ORD-0005',
    idempotencyKey: 'checkout-4',
    paymentId: 'payment-5',
    printJobId: 'print-5',
  });

  assert.throws(() => executeTransaction(db, second), /UNIQUE/);
  assert.equal(count(db, 'orders'), 1);
  assert.equal(count(db, 'payments'), 1);
  assert.equal(count(db, 'print_jobs'), 1);
  assert.equal(count(db, 'sync_queue'), 1);
  assert.equal(db.prepare('SELECT order_number FROM orders').get().order_number, 'ORD-0004');
  db.close();
});

test('outbox event cannot exist without its local order', () => {
  const db = createDatabase();
  const now = '2026-09-02T08:02:00.000Z';

  assert.throws(() => executeTransaction(db, [{
    sql: `INSERT INTO sync_queue (
      id, entity_type, entity_id, operation, idempotency_key, client_sequence,
      payload, status, attempts, last_error, locked_by, locked_until, created_at, updated_at
    ) VALUES (?, 'ORDER', ?, 'CREATE', ?, 1, ?, 'PENDING', 0, NULL, NULL, NULL, ?, ?)`,
    params: ['orphan-sync', 'missing-order', 'orphan-key', JSON.stringify({ id: 'missing-order' }), now, now],
  }]));

  assert.equal(count(db, 'sync_queue'), 0);
  db.close();
});
