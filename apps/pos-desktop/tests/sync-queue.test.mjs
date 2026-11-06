import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const schema = readFileSync(new URL('../src/pos/sqlite-schema.sql', import.meta.url), 'utf8');

function openDatabase(name) {
  const path = join(tmpdir(), `restaurant-pos-${name}-${process.pid}.db`);
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 2500;');
  db.exec(schema);
  return { db, path };
}

function seedQueue(db, count = 2) {
  const insert = db.prepare(`
    INSERT INTO sync_queue (
      id, entity_type, entity_id, operation, idempotency_key,
      client_sequence, payload, status, attempts, created_at, updated_at
    ) VALUES (?, 'ORDER', ?, 'CREATE', ?, ?, '{}', 'PENDING', 0, datetime('now'), datetime('now'))
  `);

  for (let index = 1; index <= count; index += 1) {
    insert.run(`item-${index}`, `order-${index}`, `key-${index}`, index);
  }
}

function claim(db, workerId, limit = 1, maxAttempts = 8, leaseSeconds = 30) {
  db.prepare(`
    UPDATE sync_queue
    SET status = CASE WHEN attempts + 1 >= ? THEN 'FAILED' ELSE 'PENDING' END,
        attempts = attempts + 1,
        last_error = 'Sync lease expired before completion',
        locked_by = NULL, locked_until = NULL, updated_at = datetime('now')
    WHERE status = 'SYNCING'
      AND locked_until IS NOT NULL
      AND locked_until <= datetime('now')
  `).run(maxAttempts);

  db.prepare(`
    UPDATE sync_queue
    SET status = 'SYNCING', locked_by = ?,
        locked_until = datetime('now', ? || ' seconds'), updated_at = datetime('now')
    WHERE id IN (
      SELECT id
      FROM sync_queue
      WHERE status IN ('PENDING', 'FAILED')
        AND attempts < ?
      ORDER BY client_sequence ASC
      LIMIT ?
    )
  `).run(workerId, leaseSeconds, maxAttempts, limit);

  return db.prepare(`
    SELECT id, locked_by, status
    FROM sync_queue
    WHERE status = 'SYNCING' AND locked_by = ?
    ORDER BY client_sequence ASC
  `).all(workerId).map((row) => ({ ...row }));
}

test('two workers claim disjoint queue items', () => {
  const { db, path } = openDatabase('concurrency');
  try {
    seedQueue(db, 2);

    const workerA = claim(db, 'worker-a', 1);
    const workerB = claim(db, 'worker-b', 1);

    assert.deepEqual(workerA, [{ id: 'item-1', locked_by: 'worker-a', status: 'SYNCING' }]);
    assert.deepEqual(workerB, [{ id: 'item-2', locked_by: 'worker-b', status: 'SYNCING' }]);

    const syncing = db.prepare(`SELECT id, locked_by FROM sync_queue WHERE status = 'SYNCING' ORDER BY id`).all().map((row) => ({ ...row }));
    assert.deepEqual(syncing, [
      { id: 'item-1', locked_by: 'worker-a' },
      { id: 'item-2', locked_by: 'worker-b' },
    ]);
  } finally {
    db.close();
    rmSync(path, { force: true });
  }
});

test('expired lease is recovered by the next worker', () => {
  const { db, path } = openDatabase('recovery');
  try {
    seedQueue(db, 1);
    assert.deepEqual(claim(db, 'worker-a', 1).map((row) => row.id), ['item-1']);

    db.prepare(`UPDATE sync_queue SET locked_until = datetime('now', '-1 second') WHERE id = 'item-1'`).run();

    const recovered = claim(db, 'worker-b', 1);
    assert.deepEqual(recovered, [{ id: 'item-1', locked_by: 'worker-b', status: 'SYNCING' }]);
  } finally {
    db.close();
    rmSync(path, { force: true });
  }
});

test('expired leases consume retry budget and exhausted leases become failed', () => {
  const { db, path } = openDatabase('expired-attempts');
  try {
    seedQueue(db, 2);
    claim(db, 'worker-a', 2, 3);
    db.prepare(`UPDATE sync_queue SET locked_until = datetime('now', '-1 second') WHERE id IN ('item-1', 'item-2')`).run();
    db.prepare(`UPDATE sync_queue SET attempts = 2 WHERE id = 'item-2'`).run();

    const recovered = claim(db, 'worker-b', 2, 3);
    assert.deepEqual(recovered.map((row) => row.id), ['item-1']);

    const states = db.prepare(`SELECT id, status, attempts, last_error FROM sync_queue ORDER BY id`).all().map((row) => ({ ...row }));
    assert.deepEqual(states, [
      { id: 'item-1', status: 'SYNCING', attempts: 1, last_error: 'Sync lease expired before completion' },
      { id: 'item-2', status: 'FAILED', attempts: 3, last_error: 'Sync lease expired before completion' },
    ]);
  } finally {
    db.close();
    rmSync(path, { force: true });
  }
});

test('stale worker cannot complete a lease it no longer owns', () => {
  const { db, path } = openDatabase('fencing');
  try {
    seedQueue(db, 1);
    claim(db, 'worker-a', 1);
    db.prepare(`UPDATE sync_queue SET locked_until = datetime('now', '-1 second') WHERE id = 'item-1'`).run();
    claim(db, 'worker-b', 1);

    const staleCompletion = db.prepare(`
      UPDATE sync_queue
      SET status = 'SYNCED', locked_by = NULL, locked_until = NULL, last_error = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'SYNCING' AND locked_by = ?
    `).run('item-1', 'worker-a');

    assert.equal(staleCompletion.changes, 0);
    assert.equal(db.prepare(`SELECT status FROM sync_queue WHERE id = 'item-1'`).get().status, 'SYNCING');

    const validCompletion = db.prepare(`
      UPDATE sync_queue
      SET status = 'SYNCED', locked_by = NULL, locked_until = NULL, last_error = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'SYNCING' AND locked_by = ?
    `).run('item-1', 'worker-b');

    assert.equal(validCompletion.changes, 1);
    assert.equal(db.prepare(`SELECT status FROM sync_queue WHERE id = 'item-1'`).get().status, 'SYNCED');
  } finally {
    db.close();
    rmSync(path, { force: true });
  }
});

test('failed attempts remain bounded by maxAttempts', () => {
  const { db, path } = openDatabase('attempts');
  try {
    seedQueue(db, 1);
    db.prepare(`UPDATE sync_queue SET status = 'FAILED', attempts = 8 WHERE id = 'item-1'`).run();
    assert.deepEqual(claim(db, 'worker-a', 1, 8), []);
  } finally {
    db.close();
    rmSync(path, { force: true });
  }
});
