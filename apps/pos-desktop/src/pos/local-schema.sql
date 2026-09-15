PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  device_code TEXT NOT NULL,
  name TEXT NOT NULL,
  last_sync_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0),
  category_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK(order_type IN ('DINE_IN','TAKEAWAY','DELIVERY')),
  status TEXT NOT NULL,
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  discount REAL NOT NULL DEFAULT 0 CHECK(discount >= 0),
  delivery_fee REAL NOT NULL DEFAULT 0 CHECK(delivery_fee >= 0),
  total REAL NOT NULL CHECK(total >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  note TEXT
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')),
  opening_cash REAL NOT NULL CHECK(opening_cash >= 0),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  closing_cash REAL,
  expected_cash REAL,
  variance REAL
);

CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  cashier_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('OPENING_FLOAT','SALE','CASH_CHANGE','REFUND','PAY_IN','PAY_OUT','ADJUSTMENT')),
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  amount REAL NOT NULL CHECK(amount > 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  reason TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  method TEXT NOT NULL CHECK(method IN ('CASH','CARD','WALLET','OTHER')),
  amount REAL NOT NULL CHECK(amount > 0),
  reference TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  order_id TEXT,
  station TEXT NOT NULL,
  printer_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('QUEUED','PRINTING','PRINTED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  printed_at TEXT
);

CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  station TEXT NOT NULL CHECK(station IN ('KITCHEN','BEVERAGE','PACKING')),
  status TEXT NOT NULL CHECK(status IN ('SENT_TO_KITCHEN','PREPARING','READY','COMPLETED','CANCELLED')),
  version INTEGER NOT NULL CHECK(version > 0),
  order_number TEXT NOT NULL,
  order_type TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  preparing_at TEXT,
  ready_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_station_status ON kitchen_tickets(station, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_order ON kitchen_tickets(order_id);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL DEFAULT '',
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  client_sequence INTEGER NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments(shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_shift ON cash_drawer_movements(shift_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, client_sequence);
