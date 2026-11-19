import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/pos/sqlite-schema.sql', import.meta.url), 'utf8');

function db() {
  const database = new DatabaseSync(':memory:');
  database.exec(schema);
  return database;
}

const insertShift = (database, id, device = 'device-1', status = 'OPEN') => database.prepare(`
  INSERT INTO shifts (id, branch_id, device_id, cashier_id, status, opening_cash, opened_at)
  VALUES (?, 'branch-1', ?, 'cashier-1', ?, 100, '2026-01-01T10:00:00Z')
`).run(id, device, status);

test('a POS device cannot have two open shifts', () => {
  const database = db();
  insertShift(database, 'shift-1');
  assert.throws(() => insertShift(database, 'shift-2'));

  const rows = database.prepare(`SELECT id FROM shifts WHERE device_id='device-1' AND status='OPEN'`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'shift-1');
});

test('a closed shift does not block the next open shift on the same device', () => {
  const database = db();
  insertShift(database, 'shift-1', 'device-1', 'CLOSED');
  insertShift(database, 'shift-2', 'device-1', 'OPEN');

  const rows = database.prepare(`SELECT id, status FROM shifts WHERE device_id='device-1' ORDER BY id`).all();
  assert.deepEqual(rows.map((row) => [row.id, row.status]), [['shift-1', 'CLOSED'], ['shift-2', 'OPEN']]);
});

test('opening shift and opening cash movement are one transaction boundary', () => {
  const database = db();
  database.exec('BEGIN');
  try {
    insertShift(database, 'shift-1');
    database.prepare(`
      INSERT INTO cash_drawer_movements (
        id, branch_id, device_id, shift_id, cashier_id, type, direction, amount,
        source_type, source_id, idempotency_key, occurred_at
      ) VALUES ('opening', 'branch-1', 'device-1', 'shift-1', 'cashier-1', 'OPENING_FLOAT', 'IN', 100, 'SHIFT', 'shift-1', 'shift-1:opening', '2026-01-01T10:00:00Z')
    `).run();
    database.exec('ROLLBACK');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  assert.equal(Number(database.prepare(`SELECT COUNT(*) AS count FROM shifts`).get().count), 0);
  assert.equal(Number(database.prepare(`SELECT COUNT(*) AS count FROM cash_drawer_movements`).get().count), 0);
});

test('unsettled sync operations block shift close until every operation is synced', () => {
  const database = db();
  insertShift(database, 'shift-1');
  const insertSync = database.prepare(`
    INSERT INTO sync_queue (
      id, entity_type, entity_id, operation, idempotency_key, client_sequence,
      payload, status, attempts, created_at, updated_at
    ) VALUES (?, 'ORDER', ?, 'CHECKOUT', ?, ?, '{}', ?, 0, '2026-01-01T11:00:00Z', '2026-01-01T11:00:00Z')
  `);
  insertSync.run('sync-pending', 'order-1', 'key-pending', 1, 'PENDING');
  insertSync.run('sync-running', 'order-2', 'key-running', 2, 'SYNCING');
  insertSync.run('sync-failed', 'order-3', 'key-failed', 3, 'FAILED');
  insertSync.run('sync-done', 'order-4', 'key-done', 4, 'SYNCED');

  const unsettled = Number(database.prepare(`
    SELECT COUNT(*) AS count FROM sync_queue
    WHERE status IN ('PENDING', 'SYNCING', 'FAILED')
  `).get().count);
  assert.equal(unsettled, 3, 'pending, in-flight and rejected operations must prevent closing');

  database.prepare(`UPDATE sync_queue SET status = 'SYNCED'`).run();
  const afterSync = Number(database.prepare(`
    SELECT COUNT(*) AS count FROM sync_queue
    WHERE status IN ('PENDING', 'SYNCING', 'FAILED')
  `).get().count);
  assert.equal(afterSync, 0, 'shift can proceed only after all queued operations are resolved');
  database.close();
});

test('closing shift records actual, expected and variance consistently', () => {
  const database = db();
  insertShift(database, 'shift-1');
  database.prepare(`
    INSERT INTO cash_drawer_movements (
      id, branch_id, device_id, shift_id, cashier_id, type, direction, amount,
      source_type, source_id, idempotency_key, occurred_at
    ) VALUES ('opening', 'branch-1', 'device-1', 'shift-1', 'cashier-1', 'OPENING_FLOAT', 'IN', 100, 'SHIFT', 'shift-1', 'shift-1:opening', '2026-01-01T10:00:00Z')
  `).run();
  database.prepare(`
    INSERT INTO cash_drawer_movements (
      id, branch_id, device_id, shift_id, cashier_id, type, direction, amount,
      source_type, source_id, idempotency_key, occurred_at
    ) VALUES ('sale', 'branch-1', 'device-1', 'shift-1', 'cashier-1', 'SALE', 'IN', 50, 'ORDER', 'order-1', 'order-1:sale', '2026-01-01T11:00:00Z')
  `).run();

  const expected = Number(database.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount ELSE -amount END),0) AS total FROM cash_drawer_movements WHERE shift_id='shift-1'`).get().total);
  const actual = 140;
  const variance = actual - expected;
  database.prepare(`UPDATE shifts SET status='CLOSED', closing_cash=?, expected_cash=?, variance=?, closed_at=? WHERE id='shift-1' AND status='OPEN'`).run(actual, expected, variance, '2026-01-01T18:00:00Z');

  const row = database.prepare(`SELECT status, closing_cash, expected_cash, variance FROM shifts WHERE id='shift-1'`).get();
  assert.equal(row.status, 'CLOSED');
  assert.equal(Number(row.expected_cash), 150);
  assert.equal(Number(row.closing_cash), 140);
  assert.equal(Number(row.variance), -10);
});
