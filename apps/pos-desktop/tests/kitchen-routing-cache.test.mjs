import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/pos/sqlite-schema.sql', import.meta.url), 'utf8');

test('existing local databases gain product kitchen routing without altering products table', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL, price REAL NOT NULL, category_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
  `);
  db.exec(schema);

  const routingTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='product_kitchen_routing'`).get();
  assert.equal(routingTable.name, 'product_kitchen_routing');

  const productColumns = [...db.prepare('PRAGMA table_info(products)').all()].map((column) => column.name);
  assert.equal(productColumns.includes('kitchen_station'), false);

  db.prepare(`INSERT INTO products(id,sku,name_ar,name_en,price,category_id,active,updated_at) VALUES
    ('burger','BRG-1','برجر','Burger',100,'meals',1,'2026-11-19'),
    ('cola','DRK-1','كولا','Cola',20,'drinks',1,'2026-11-19')`).run();
  db.prepare(`INSERT INTO product_kitchen_routing(product_id,kitchen_station,updated_at) VALUES
    ('burger','KITCHEN','2026-11-19'),
    ('cola','BEVERAGE','2026-11-19')`).run();

  const rows = db.prepare(`
    SELECT p.id, COALESCE(r.kitchen_station, 'KITCHEN') AS kitchen_station
    FROM products p LEFT JOIN product_kitchen_routing r ON r.product_id=p.id
    ORDER BY p.id
  `).all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'burger');
  assert.equal(rows[0].kitchen_station, 'KITCHEN');
  assert.equal(rows[1].id, 'cola');
  assert.equal(rows[1].kitchen_station, 'BEVERAGE');
  db.close();
});

test('unknown or missing cached station safely falls back to KITCHEN', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.prepare(`INSERT INTO products(id,sku,name_ar,name_en,price,category_id,active,updated_at) VALUES ('legacy','OLD-1','صنف قديم','Legacy',10,'misc',1,'2026-11-19')`).run();
  const row = db.prepare(`
    SELECT COALESCE(r.kitchen_station, 'KITCHEN') AS kitchen_station
    FROM products p LEFT JOIN product_kitchen_routing r ON r.product_id=p.id WHERE p.id='legacy'
  `).get();
  assert.equal(row.kitchen_station, 'KITCHEN');
  db.close();
});
