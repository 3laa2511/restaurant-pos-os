-- ==============================================================================
-- BO'SH STORE RETAIL PLATFORM — PRODUCTION POSTGRESQL SCHEMA MIGRATION
-- Migration Version: 20260901_001_initial_schema
-- Target: Supabase PostgreSQL 15+
-- Description: Authoritative schema for Products, Inventory, Orders, Repairs, 
--              Gaming Lounge, POS, CRM, Finance, Audit, and Idempotency.
-- ==============================================================================

-- 1. EXTENSIONS & PREREQUISITES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. ENUMS & DOMAIN TYPES
-- ==============================================================================

DO $$ BEGIN
  CREATE TYPE user_role_enum AS ENUM (
    'owner', 'admin', 'store_manager', 'manager', 'cashier', 
    'repair_manager', 'technician', 'gaming_staff', 'lounge_host', 
    'warehouse_staff', 'warehouse', 'customer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE product_status_enum AS ENUM ('draft', 'published', 'archived', 'out_of_stock');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE product_condition_enum AS ENUM ('new', 'used', 'refurbished', 'service', 'digital');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE warranty_type_enum AS ENUM ('none', 'store', 'agent', 'international');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inventory_movement_type_enum AS ENUM (
    'purchase_received', 'sale', 'return', 'damage', 
    'adjustment', 'transfer_in', 'transfer_out', 'transfer', 
    'trade_in', 'repair_consumption'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE serial_status_enum AS ENUM (
    'in_stock', 'sold', 'in_repair', 'returned', 'damaged', 
    'traded_in', 'archived', 'decommissioned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status_enum AS ENUM (
    'pending', 'confirmed', 'preparing', 'ready_for_shipping', 
    'shipped', 'delivered', 'cancelled', 'return_requested', 'returned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method_enum AS ENUM ('cod', 'card', 'wallet', 'instapay', 'mixed', 'pos_cash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status_enum AS ENUM ('pending', 'authorized', 'paid', 'partially_paid', 'refunded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE repair_status_enum AS ENUM (
    'received', 'diagnosis', 'waiting_approval', 'approved', 
    'in_repair', 'quality_control', 'ready', 'delivered', 
    'cancelled', 'rejected', 'warranty_claim'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE station_status_enum AS ENUM ('available', 'playing', 'reserved', 'maintenance', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ==============================================================================
-- 3. USERS, ROLES & PERMISSIONS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id VARCHAR(100) PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id VARCHAR(50) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id VARCHAR(100) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, -- References auth.users(id) if Supabase Auth is bound
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  role user_role_enum NOT NULL DEFAULT 'cashier',
  role_title VARCHAR(100) NOT NULL DEFAULT 'Staff Member',
  avatar TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  can_access_finance BOOLEAN NOT NULL DEFAULT false,
  can_modify_prices BOOLEAN NOT NULL DEFAULT false,
  can_adjust_stock BOOLEAN NOT NULL DEFAULT false,
  can_delete_records BOOLEAN NOT NULL DEFAULT false,
  can_approve_discounts BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 4. CUSTOMERS & CRM
-- ==============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255),
  governorate VARCHAR(100),
  city VARCHAR(100),
  address TEXT,
  loyalty_points INT NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_spent >= 0),
  orders_count INT NOT NULL DEFAULT 0 CHECK (orders_count >= 0),
  repairs_count INT NOT NULL DEFAULT 0 CHECK (repairs_count >= 0),
  gaming_hours NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (gaming_hours >= 0),
  tier VARCHAR(50) NOT NULL DEFAULT 'bronze',
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  governorate VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  street_address TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID UNIQUE NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points_balance INT NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  tier VARCHAR(50) NOT NULL DEFAULT 'bronze',
  lifetime_points_earned INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loyalty_account_id UUID NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points_delta INT NOT NULL,
  resulting_balance INT NOT NULL CHECK (resulting_balance >= 0),
  type VARCHAR(50) NOT NULL, -- 'EARN_ORDER', 'REDEEM_DISCOUNT', 'BONUS', 'EXPIRATION'
  reference_type VARCHAR(50),
  reference_id VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 5. CATALOG (CATEGORIES, BRANDS, WAREHOUSES, PRODUCTS)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  description_ar TEXT,
  icon VARCHAR(100) NOT NULL DEFAULT 'Package',
  image TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_no_self_parent CHECK (id != parent_category_id)
);

CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  logo TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255) NOT NULL,
  location VARCHAR(255) NOT NULL,
  is_main BOOLEAN NOT NULL DEFAULT false,
  contact_phone VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(100) UNIQUE NOT NULL,
  barcode VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  description_ar TEXT NOT NULL DEFAULT '',
  short_description TEXT NOT NULL DEFAULT '',
  short_description_ar TEXT NOT NULL DEFAULT '',
  category_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
  category_name VARCHAR(255),
  brand_id UUID REFERENCES brands(id) ON DELETE RESTRICT,
  brand_name VARCHAR(255),
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  compare_at_price NUMERIC(12, 2) CHECK (compare_at_price IS NULL OR compare_at_price >= 0),
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0),
  discount NUMERIC(12, 2) DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold INT NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  status product_status_enum NOT NULL DEFAULT 'published',
  condition product_condition_enum NOT NULL DEFAULT 'new',
  warranty_period VARCHAR(100) NOT NULL DEFAULT '12 Months',
  warranty_type warranty_type_enum NOT NULL DEFAULT 'store',
  weight VARCHAR(50),
  dimensions VARCHAR(100),
  featured BOOLEAN NOT NULL DEFAULT false,
  best_seller BOOLEAN NOT NULL DEFAULT false,
  new_arrival BOOLEAN NOT NULL DEFAULT false,
  is_serialized BOOLEAN NOT NULL DEFAULT false,
  rating NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
  reviews_count INT NOT NULL DEFAULT 0,
  primary_image TEXT NOT NULL,
  images TEXT[] NOT NULL DEFAULT '{}',
  specifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  seo_title VARCHAR(255),
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  spec_key VARCHAR(100) NOT NULL,
  spec_value VARCHAR(255) NOT NULL
);

-- ==============================================================================
-- 6. INVENTORY & SERIAL TRACKING
-- ==============================================================================

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  type inventory_movement_type_enum NOT NULL,
  quantity INT NOT NULL, -- positive for additions, negative for deductions
  previous_quantity INT NOT NULL CHECK (previous_quantity >= 0),
  resulting_quantity INT NOT NULL CHECK (resulting_quantity >= 0),
  reason TEXT NOT NULL,
  reference_type VARCHAR(50), -- 'order', 'purchase_order', 'repair', 'manual_adjustment', 'return', 'stocktake'
  reference_id VARCHAR(100),
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  performed_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS serialized_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(255) NOT NULL,
  serial_number VARCHAR(150) UNIQUE NOT NULL,
  barcode VARCHAR(100),
  purchase_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (purchase_cost >= 0),
  selling_price NUMERIC(12, 2) NOT NULL CHECK (selling_price >= 0),
  condition VARCHAR(50) NOT NULL DEFAULT 'new',
  status serial_status_enum NOT NULL DEFAULT 'in_stock',
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  customer_phone VARCHAR(50),
  order_id UUID,
  order_number VARCHAR(100),
  sold_at TIMESTAMPTZ,
  warranty_expiry DATE,
  repair_count INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stocktake_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  system_stock INT NOT NULL,
  physical_count INT NOT NULL,
  difference INT NOT NULL,
  reason TEXT NOT NULL,
  conducted_by VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 7. COUPONS & SHIPPING RATES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(10, 2) NOT NULL CHECK (discount_value > 0),
  min_order_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (min_order_amount >= 0),
  max_discount_amount NUMERIC(10, 2),
  start_date TIMESTAMPTZ NOT NULL,
  expiration_date TIMESTAMPTZ NOT NULL,
  usage_limit INT NOT NULL DEFAULT 0 CHECK (usage_limit >= 0),
  usage_count INT NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  per_customer_limit INT NOT NULL DEFAULT 1 CHECK (per_customer_limit >= 1),
  is_active BOOLEAN NOT NULL DEFAULT true,
  applicable_category_ids TEXT[] DEFAULT '{}',
  description_en TEXT,
  description_ar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id UUID,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  discount_applied NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipping_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  governorate VARCHAR(100) UNIQUE NOT NULL,
  governorate_ar VARCHAR(100) NOT NULL,
  standard_fee NUMERIC(10, 2) NOT NULL CHECK (standard_fee >= 0),
  express_fee NUMERIC(10, 2) NOT NULL CHECK (express_fee >= 0),
  free_shipping_threshold NUMERIC(10, 2) NOT NULL CHECK (free_shipping_threshold >= 0),
  estimated_days VARCHAR(100) NOT NULL,
  estimated_days_ar VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- ==============================================================================
-- 8. ORDERS & ORDER ITEMS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(100) UNIQUE NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'online_store', -- 'online_store', 'pos_store', 'pos_cashier', 'phone_order'
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL,
  customer_email VARCHAR(255),
  subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0),
  coupon_code VARCHAR(50),
  shipping_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (shipping_fee >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  status order_status_enum NOT NULL DEFAULT 'pending',
  payment_method payment_method_enum NOT NULL DEFAULT 'cod',
  payment_status payment_status_enum NOT NULL DEFAULT 'pending',
  shipping_address JSONB NOT NULL,
  notes TEXT,
  tracking_number VARCHAR(100),
  inventory_deducted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  image TEXT,
  serial_number VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status order_status_enum NOT NULL,
  new_status order_status_enum NOT NULL,
  changed_by VARCHAR(255) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method payment_method_enum NOT NULL,
  status payment_status_enum NOT NULL DEFAULT 'pending',
  transaction_ref VARCHAR(100),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cash_amount NUMERIC(12, 2) DEFAULT 0.00,
  card_amount NUMERIC(12, 2) DEFAULT 0.00,
  wallet_amount NUMERIC(12, 2) DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 9. HARDWARE REPAIR LAB
-- ==============================================================================

CREATE TABLE IF NOT EXISTS repair_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number VARCHAR(100) UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL,
  device_type VARCHAR(100) NOT NULL,
  device_model VARCHAR(255) NOT NULL,
  serial_number VARCHAR(150) NOT NULL,
  problem_description TEXT NOT NULL,
  device_condition TEXT,
  accessories_received TEXT[] NOT NULL DEFAULT '{}',
  photos TEXT[] NOT NULL DEFAULT '{}',
  diagnosis TEXT,
  estimate JSONB NOT NULL DEFAULT '{"parts":[],"partsTotal":0,"laborFee":0,"cleaningFee":0,"discount":0,"grandTotal":0,"isApprovedByCustomer":false}'::jsonb,
  estimate_locked BOOLEAN NOT NULL DEFAULT false,
  technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  technician_name VARCHAR(255),
  technician_notes TEXT,
  parts_used TEXT[] NOT NULL DEFAULT '{}',
  status repair_status_enum NOT NULL DEFAULT 'received',
  warranty_days INT NOT NULL DEFAULT 90,
  warranty_expiry DATE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  notes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repair_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  previous_status VARCHAR(50) NOT NULL,
  new_status VARCHAR(50) NOT NULL,
  changed_by_id UUID,
  changed_by_name VARCHAR(255) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repair_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  part_name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0),
  customer_price NUMERIC(12, 2) NOT NULL CHECK (customer_price >= 0),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 10. GAMING LOUNGE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS gaming_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  name_ar VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'ps5_standard',
  screen_model VARCHAR(100) NOT NULL DEFAULT 'Sony Bravia 55" 4K 120Hz',
  controllers_count INT NOT NULL DEFAULT 2,
  current_status station_status_enum NOT NULL DEFAULT 'available',
  current_session_id UUID,
  installed_games TEXT[] NOT NULL DEFAULT '{}',
  hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 50.00 CHECK (hourly_rate >= 0),
  hourly_rate_single NUMERIC(10, 2) NOT NULL DEFAULT 50.00 CHECK (hourly_rate_single >= 0),
  hourly_rate_multi NUMERIC(10, 2) NOT NULL DEFAULT 70.00 CHECK (hourly_rate_multi >= 0),
  is_vip BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gaming_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_number VARCHAR(100) UNIQUE NOT NULL,
  station_id UUID NOT NULL REFERENCES gaming_stations(id) ON DELETE RESTRICT,
  station_code VARCHAR(50) NOT NULL,
  station_name VARCHAR(100),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  player_count INT NOT NULL DEFAULT 1 CHECK (player_count >= 1 AND player_count <= 4),
  pricing_type VARCHAR(50) NOT NULL DEFAULT 'single',
  hourly_rate NUMERIC(10, 2) NOT NULL CHECK (hourly_rate >= 0),
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  total_minutes INT DEFAULT 0 CHECK (total_minutes >= 0),
  time_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (time_amount >= 0),
  addons JSONB NOT NULL DEFAULT '[]'::jsonb,
  addons_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (addons_amount >= 0),
  discount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0),
  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
  payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  staff_id VARCHAR(100) NOT NULL,
  staff_name VARCHAR(255) NOT NULL,
  notes TEXT,
  snacks JSONB NOT NULL DEFAULT '[]'::jsonb,
  tariff JSONB NOT NULL DEFAULT '{}'::jsonb,
  game_playing VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gaming_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_code VARCHAR(100) UNIQUE NOT NULL,
  station_id UUID NOT NULL REFERENCES gaming_stations(id) ON DELETE RESTRICT,
  station_code VARCHAR(50) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  start_time VARCHAR(20) NOT NULL,
  duration_hours NUMERIC(4, 2) NOT NULL CHECK (duration_hours > 0),
  player_count INT NOT NULL DEFAULT 1,
  deposit_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (deposit_amount >= 0),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 11. SUPPLIERS & PURCHASING
-- ==============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255),
  address TEXT NOT NULL,
  tax_number VARCHAR(100),
  category VARCHAR(100) NOT NULL,
  total_purchases NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_purchases >= 0),
  outstanding_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  rating NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number VARCHAR(100) UNIQUE NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_name VARCHAR(255) NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_cost NUMERIC(12, 2) NOT NULL CHECK (total_cost >= 0),
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  destination_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  destination_warehouse_name VARCHAR(255),
  payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_date DATE,
  received_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 12. EXPENSES & FINANCIAL LEDGER
-- ==============================================================================

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255),
  description TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  paid_by VARCHAR(255),
  recorded_by_name VARCHAR(255),
  payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
  receipt_url TEXT,
  reference_number VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_ref VARCHAR(100) UNIQUE NOT NULL,
  channel VARCHAR(50) NOT NULL, -- 'retail_ecommerce', 'pos', 'repair', 'gaming', 'expense'
  type VARCHAR(50) NOT NULL, -- 'revenue', 'cogs', 'operating_expense', 'refund'
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  cogs NUMERIC(12, 2) DEFAULT 0.00 CHECK (cogs >= 0),
  net_profit NUMERIC(12, 2) DEFAULT 0.00,
  reference_id VARCHAR(100),
  description TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 13. AUDIT LOGS & NOTIFICATIONS (IMMUTABLE)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100),
  user_name VARCHAR(255) NOT NULL,
  user_role VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  ip_address VARCHAR(50),
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  title_ar VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  message_ar TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 14. IDEMPOTENCY KEYS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compound_key VARCHAR(255) UNIQUE NOT NULL,
  user_scope VARCHAR(100) NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  http_method VARCHAR(10) NOT NULL,
  status_code INT NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- ==============================================================================
-- 15. PERFORMANCE INDEXES
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured) WHERE featured = true;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements(type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_serialized_devices_sn ON serialized_devices(serial_number);
CREATE INDEX IF NOT EXISTS idx_serialized_devices_status ON serialized_devices(status);
CREATE INDEX IF NOT EXISTS idx_serialized_devices_product ON serialized_devices(product_id);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

CREATE INDEX IF NOT EXISTS idx_repair_tickets_status ON repair_tickets(status);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_number ON repair_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_serial ON repair_tickets(serial_number);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_technician ON repair_tickets(technician_id);

CREATE INDEX IF NOT EXISTS idx_gaming_stations_code ON gaming_stations(code);
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_station ON gaming_sessions(station_id);
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_status ON gaming_sessions(status);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_compound ON idempotency_keys(compound_key);
