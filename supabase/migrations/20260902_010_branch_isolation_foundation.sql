-- ============================================================================
-- BO'SH STORE — BRANCH ISOLATION FOUNDATION
-- Adds explicit branch ownership without breaking existing seeded records.
-- Enforcement remains server-side; service-role access must never imply global
-- staff visibility.
-- ============================================================================

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255) NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

ALTER TABLE repair_tickets
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

ALTER TABLE gaming_stations
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

ALTER TABLE gaming_sessions
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

ALTER TABLE gaming_reservations
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

ALTER TABLE stocktake_records
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_branch_id ON profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_branch_id ON warehouses(branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch_id ON orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_repairs_branch_id ON repair_tickets(branch_id);
CREATE INDEX IF NOT EXISTS idx_gaming_stations_branch_id ON gaming_stations(branch_id);
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_branch_id ON gaming_sessions(branch_id);
CREATE INDEX IF NOT EXISTS idx_gaming_reservations_branch_id ON gaming_reservations(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_id ON inventory_movements(branch_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_branch_id ON stocktake_records(branch_id);

-- Safe initial branch for a single-store deployment. Existing records remain
-- nullable until an operator maps them to their real branch.
INSERT INTO branches (code, name, name_ar)
VALUES ('MAIN', 'Main Branch', 'الفرع الرئيسي')
ON CONFLICT (code) DO NOTHING;
