-- ==============================================================================
-- BO'SH STORE RETAIL PLATFORM — ROW LEVEL SECURITY POLICIES
-- Migration Version: 20260901_002_rls_policies
-- Target: Supabase PostgreSQL 15+
-- ==============================================================================

-- 1. ENABLE RLS ON ALL DOMAIN TABLES
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE serialized_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaming_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaming_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaming_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- 2. PUBLIC STOREFRONT POLICIES (ANONYMOUS & AUTHENTICATED BROWSING)

-- Public read access to active categories, brands, published products, and active shipping rates
CREATE POLICY "Public can view published products" ON products
  FOR SELECT USING (status = 'published');

CREATE POLICY "Public can view active categories" ON categories
  FOR SELECT USING (is_active = true);

CREATE POLICY "Public can view active brands" ON brands
  FOR SELECT USING (is_active = true);

CREATE POLICY "Public can view active shipping rates" ON shipping_rates
  FOR SELECT USING (is_active = true);

CREATE POLICY "Public can validate active coupons" ON coupons
  FOR SELECT USING (is_active = true AND expiration_date > NOW());

CREATE POLICY "Public can view available gaming stations" ON gaming_stations
  FOR SELECT USING (true);

-- 3. ORDERS POLICIES
-- Customers can create orders; staff/service role can manage all orders
CREATE POLICY "Public/Customers can create orders" ON orders
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Public/Customers can create order items" ON order_items
  FOR INSERT WITH CHECK (true);

-- Service Role / Authenticated backend has full access to manage domain tables
CREATE POLICY "Service role full access on products" ON products
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on inventory_movements" ON inventory_movements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on serialized_devices" ON serialized_devices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on orders" ON orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on order_items" ON order_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on payments" ON payments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on repair_tickets" ON repair_tickets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on repair_status_history" ON repair_status_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on gaming_stations" ON gaming_stations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on gaming_sessions" ON gaming_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on gaming_reservations" ON gaming_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on customers" ON customers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on expenses" ON expenses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on audit_logs" ON audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on profiles" ON profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on idempotency_keys" ON idempotency_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);
