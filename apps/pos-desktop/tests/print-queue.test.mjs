import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/pos/sqlite-schema.sql', import.meta.url), 'utf8');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.exec(`
    INSERT INTO orders (id, order_number, branch_id, device_id, cashier_id, type, status, subtotal, discount, delivery_fee, total, created_at, updated_at)
    VALUES ('order-1', 'BR01-01-000001', 'branch-1', 'device-1', 'cashier-1', 'TAKEAWAY', 'CONFIRMED', 100, 0, 0, 100, '2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z');
    INSERT INTO print_jobs (id, order_id, station, payload, status, attempts, last_error, created_at, updated_at)
    VALUES ('print-1', 'order-1', 'KITCHEN', 'payload-1', 'PENDING', 0, NULL, '2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z');
  `);
  return db;
}

function claim(db, workerId, limit = 10, maxAttempts = 3, leaseSeconds = 30) {
  db.prepare(`
    UPDATE print_jobs
    SET status = 'PENDING', locked_by = NULL, locked_until = NULL, updated_at = datetime('now')
    WHERE status = 'PRINTING' AND locked_until IS NOT NULL AND locked_until <= datetime('now')
  `).run();
  db.prepare(`
    UPDATE print_jobs
    SET status = 'PRINTING', locked_by = ?,
        locked_until = datetime('now', ? || ' seconds'), updated_at = datetime('now')
    WHERE id IN (
      SELECT id FROM print_jobs
      WHERE status IN ('PENDING','FAILED') AND attempts < ?
      ORDER BY created_at ASC LIMIT ?
    )
  `).run(workerId, leaseSeconds, maxAttempts, limit);
  return [...db.prepare(`SELECT id, status, locked_by, locked_until, attempts FROM print_jobs WHERE status='PRINTING' AND locked_by=? ORDER BY created_at`).all(workerId)];
}

test('two print workers claim disjoint jobs', () => {
  const db = createDatabase();
  db.exec(`INSERT INTO print_jobs (id, order_id, station, payload, status, attempts, created_at, updated_at) VALUES ('print-2','order-1','BAR','payload-2','PENDING',0,'2026-01-01T10:00:01Z','2026-01-01T10:00:01Z');`);
  const first = claim(db, 'worker-a', 1);
  const second = claim(db, 'worker-b', 1);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0].id, second[0].id);
});

test('expired print lease is recovered', () => {
  const db = createDatabase();
  db.prepare(`UPDATE print_jobs SET status='PRINTING', locked_by='dead-worker', locked_until=datetime('now','-1 second') WHERE id='print-1'`).run();
  const claimed = claim(db, 'recovery-worker');
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, 'print-1');
  assert.equal(claimed[0].locked_by, 'recovery-worker');
});

test('stale worker cannot mark a reclaimed job as printed', () => {
  const db = createDatabase();
  db.prepare(`UPDATE print_jobs SET status='PRINTING', locked_by='old-worker', locked_until=datetime('now','-1 second') WHERE id='print-1'`).run();
  claim(db, 'new-worker');
  db.prepare(`UPDATE print_jobs SET status='PRINTED', locked_by=NULL, locked_until=NULL WHERE id='print-1' AND status='PRINTING' AND locked_by='old-worker'`).run();
  const row = db.prepare(`SELECT status, locked_by FROM print_jobs WHERE id='print-1'`).get();
  assert.equal(row.status, 'PRINTING');
  assert.equal(row.locked_by, 'new-worker');
});

test('failed print attempts are bounded by maxAttempts', () => {
  const db = createDatabase();
  db.prepare(`UPDATE print_jobs SET status='FAILED', attempts=3 WHERE id='print-1'`).run();
  const claimed = claim(db, 'worker-a', 10, 3);
  assert.equal(claimed.length, 0);
});
