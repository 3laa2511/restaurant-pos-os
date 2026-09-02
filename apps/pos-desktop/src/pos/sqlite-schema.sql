PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS device_config (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL UNIQUE,
  branch_code TEXT NOT NULL,
  device_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_sequences (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  next_sequence INTEGER NOT NULL DEFAULT 0 CHECK(next_sequence >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category_id TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('DINE_IN','TAKEAWAY','DELIVERY')),
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
  device_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')),
  opened_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  method TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  reference TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  station TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','PRINTING','PRINTED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_by TEXT,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  client_sequence INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','SYNCING','SYNCED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_by TEXT,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status_sequence ON sync_queue(status, client_sequence);
CREATE INDEX IF NOT EXISTS idx_sync_queue_lease ON sync_queue(status, locked_until);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_lease ON print_jobs(status, locked_until);
