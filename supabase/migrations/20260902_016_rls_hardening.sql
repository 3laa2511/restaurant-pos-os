-- ==============================================================================
-- BO'SH STORE — RLS HARDENING
-- Migration: 20260902_016_rls_hardening
-- Purpose: close client-side write paths and protect newly introduced branch data.
-- The server API uses service_role and remains the authoritative write boundary.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Protect newly introduced branch-owned tables.
-- ------------------------------------------------------------------------------
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_inventory_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active branches" ON branches;
CREATE POLICY "Public can view active branches" ON branches
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Service role full access on branches" ON branches;
CREATE POLICY "Service role full access on branches" ON branches
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Branch stock is never a public/client-side data source. Inventory is exposed
-- through the authenticated server API, which applies branch authorization.
DROP POLICY IF EXISTS "Service role full access on branch_inventory_stock" ON branch_inventory_stock;
CREATE POLICY "Service role full access on branch_inventory_stock" ON branch_inventory_stock
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE branch_inventory_stock FROM anon, authenticated;
GRANT ALL ON TABLE branch_inventory_stock TO service_role;

-- ------------------------------------------------------------------------------
-- 2. Remove direct anonymous order writes.
-- ------------------------------------------------------------------------------
-- Orders must be created by the backend checkout flow so totals, stock,
-- customer identity, branch ownership and idempotency cannot be spoofed by a
-- browser calling Supabase directly.
DROP POLICY IF EXISTS "Public/Customers can create orders" ON orders;
DROP POLICY IF EXISTS "Public/Customers can create order items" ON order_items;

REVOKE INSERT ON TABLE orders FROM anon, authenticated;
REVOKE INSERT ON TABLE order_items FROM anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. Restrict gaming station visibility to active stations only.
-- ------------------------------------------------------------------------------
ALTER TABLE gaming_stations ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- The old policy exposed every station, including inactive/internal records.
DROP POLICY IF EXISTS "Public can view available gaming stations" ON gaming_stations;
CREATE POLICY "Public can view available gaming stations" ON gaming_stations
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Sessions/reservations are operational records and must never be directly
-- readable by an unauthenticated browser. Existing service_role access remains.
REVOKE ALL ON TABLE gaming_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE gaming_reservations FROM anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Explicitly keep sensitive operational tables server-only.
-- ------------------------------------------------------------------------------
REVOKE ALL ON TABLE inventory_movements FROM anon, authenticated;
REVOKE ALL ON TABLE serialized_devices FROM anon, authenticated;
REVOKE ALL ON TABLE repair_tickets FROM anon, authenticated;
REVOKE ALL ON TABLE repair_status_history FROM anon, authenticated;
REVOKE ALL ON TABLE payments FROM anon, authenticated;
REVOKE ALL ON TABLE expenses FROM anon, authenticated;
REVOKE ALL ON TABLE audit_logs FROM anon, authenticated;
REVOKE ALL ON TABLE idempotency_keys FROM anon, authenticated;

-- Profiles are never a client-side directory. Authentication/profile lookups
-- are performed by the trusted server provider.
REVOKE ALL ON TABLE profiles FROM anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. Defense-in-depth: prevent direct client writes to branch-owned entities.
-- ------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON TABLE warehouses FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE order_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE gaming_stations FROM anon, authenticated;

COMMENT ON TABLE branch_inventory_stock IS
  'Server-only branch inventory state. Client access is intentionally denied; use the authenticated API/RPC boundary.';
COMMENT ON TABLE branches IS
  'Branch directory. Public clients may read active branches; mutations are server-only.';
