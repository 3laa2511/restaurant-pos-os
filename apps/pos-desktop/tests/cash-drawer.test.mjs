import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/pos/sqlite-schema.sql', import.meta.url), 'utf8');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.exec(`
    INSERT INTO shifts (id, branch_id, device_id, cashier_id, status, opening_cash, opened_at)
    VALUES ('shift-1', 'branch-1', 'device-1', 'cashier-1', 'OPEN', 500, '2026-01-01T10:00:00Z');
  `);
  return db;
}

function addMovement(db, { id, type, direction, amount, sourceType, sourceId, idempotencyKey }) {
  db.prepare(`
    INSERT INTO cash_drawer_movements (
      id, branch_id, device_id, shift_id, cashier_id, type, direction, amount,
      source_type, source_id, idempotency_key, reason, occurred_at
    ) VALUES (?, 'branch-1', 'device-1', 'shift-1', 'cashier-1', ?, ?, ?, ?, ?, ?, NULL, '2026-01-01T10:01:00Z')
  `).run(id, type, direction, amount, sourceType, sourceId, idempotencyKey);
}

test('cash drawer reconciliation derives expected cash from movements', () => {
  const db = createDatabase();
  addMovement(db, { id: 'm1', type: 'OPENING_FLOAT', direction: 'IN', amount: 500, sourceType: 'SHIFT', sourceId: 'shift-1', idempotencyKey: 'shift-1:opening' });
  addMovement(db, { id: 'm2', type: 'SALE', direction: 'IN', amount: 125.5, sourceType: 'ORDER', sourceId: 'order-1', idempotencyKey: 'order-1:sale' });
  addMovement(db, { id: 'm3', type: 'CASH_CHANGE', direction: 'OUT', amount: 25.5, sourceType: 'ORDER', sourceId: 'order-1', idempotencyKey: 'order-1:change' });
  addMovement(db, { id: 'm4', type: 'PAY_OUT', direction: 'OUT', amount: 50, sourceType: 'EXPENSE', sourceId: 'expense-1', idempotencyKey: 'expense-1:payout' });

  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'OPENING_FLOAT' AND direction = 'IN' THEN amount ELSE 0 END), 0) AS opening_cash,
      COALESCE(SUM(CASE WHEN direction = 'IN' AND type != 'OPENING_FLOAT' THEN amount ELSE 0 END), 0) AS cash_in,
      COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END), 0) AS cash_out,
      COUNT(*) AS movement_count
    FROM cash_drawer_movements WHERE shift_id = 'shift-1'
  `).get();

  assert.equal(Number(row.opening_cash), 500);
  assert.equal(Number(row.cash_in), 125.5);
  assert.equal(Number(row.cash_out), 75.5);
  assert.equal(Number(row.opening_cash) + Number(row.cash_in) - Number(row.cash_out), 550);
  assert.equal(Number(row.movement_count), 4);
});

test('cash movement idempotency key prevents duplicate drawer entries', () => {
  const db = createDatabase();
  addMovement(db, { id: 'm1', type: 'SALE', direction: 'IN', amount: 100, sourceType: 'ORDER', sourceId: 'order-1', idempotencyKey: 'order-1:sale' });

  assert.throws(() => {
    addMovement(db, { id: 'm2', type: 'SALE', direction: 'IN', amount: 100, sourceType: 'ORDER', sourceId: 'order-1', idempotencyKey: 'order-1:sale' });
  });

  const row = db.prepare(`SELECT COUNT(*) AS count, SUM(amount) AS total FROM cash_drawer_movements WHERE shift_id='shift-1'`).get();
  assert.equal(Number(row.count), 1);
  assert.equal(Number(row.total), 100);
});

test('cash movement requires a real shift through foreign key integrity', () => {
  const db = createDatabase();
  assert.throws(() => {
    db.prepare(`
      INSERT INTO cash_drawer_movements (
        id, branch_id, device_id, shift_id, cashier_id, type, direction, amount,
        source_type, source_id, idempotency_key, occurred_at
      ) VALUES ('bad', 'branch-1', 'device-1', 'missing-shift', 'cashier-1', 'SALE', 'IN', 10, 'ORDER', 'order-1', 'bad:key', '2026-01-01T10:01:00Z')
    `).run();
  });
});

test('closing a shift cascades its local cash movements', () => {
  const db = createDatabase();
  addMovement(db, { id: 'm1', type: 'SALE', direction: 'IN', amount: 50, sourceType: 'ORDER', sourceId: 'order-1', idempotencyKey: 'order-1:sale' });
  db.prepare(`DELETE FROM shifts WHERE id='shift-1'`).run();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM cash_drawer_movements WHERE shift_id='shift-1'`).get();
  assert.equal(Number(row.count), 0);
});
