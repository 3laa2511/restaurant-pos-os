-- ==============================================================================
-- BO'SH STORE — ORDER -> CRM ATOMIC SYNC
-- Migration: 20260915_046_order_customer_atomic_sync
-- Purpose: make CRM registration/accounting part of the same PostgreSQL
--          transaction as order insertion. The trigger fires inside the caller's
--          transaction, so a CRM failure rolls back the order instead of leaving
--          a committed order followed by a failed customer write.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_sync_customer_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone VARCHAR(50);
  v_points INT;
BEGIN
  v_phone := NULLIF(TRIM(NEW.customer_phone), '');
  IF v_phone IS NULL THEN
    RETURN NEW;
  END IF;

  v_points := FLOOR(COALESCE(NEW.total, 0) / 100)::INT;

  INSERT INTO customers (
    id, name, phone, email, governorate, city, address,
    loyalty_points, total_spent, orders_count, repairs_count,
    gaming_hours, tier, tags, notes, last_active_at, created_at, updated_at
  ) VALUES (
    COALESCE(NEW.customer_id, gen_random_uuid()),
    COALESCE(NULLIF(TRIM(NEW.customer_name), ''), 'Customer'),
    v_phone,
    NULLIF(TRIM(NEW.customer_email), ''),
    COALESCE(NULLIF(TRIM(NEW.shipping_address->>'governorate'), ''), 'Cairo'),
    COALESCE(NULLIF(TRIM(NEW.shipping_address->>'city'), ''), 'Cairo'),
    COALESCE(NULLIF(TRIM(NEW.shipping_address->>'streetAddress'), ''), ''),
    GREATEST(v_points, 0),
    GREATEST(COALESCE(NEW.total, 0), 0),
    1, 0, 0, 'bronze', '{}', NULL,
    NOW(), NOW(), NOW()
  )
  ON CONFLICT (phone) DO UPDATE SET
    name = EXCLUDED.name,
    email = COALESCE(EXCLUDED.email, customers.email),
    governorate = EXCLUDED.governorate,
    city = EXCLUDED.city,
    address = EXCLUDED.address,
    loyalty_points = customers.loyalty_points + EXCLUDED.loyalty_points,
    total_spent = customers.total_spent + EXCLUDED.total_spent,
    orders_count = customers.orders_count + 1,
    last_active_at = NOW(),
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_sync_customer ON orders;
CREATE TRIGGER trg_orders_sync_customer
AFTER INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION fn_sync_customer_from_order();

REVOKE ALL ON FUNCTION fn_sync_customer_from_order() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_sync_customer_from_order() FROM anon;
REVOKE ALL ON FUNCTION fn_sync_customer_from_order() FROM authenticated;
GRANT EXECUTE ON FUNCTION fn_sync_customer_from_order() TO service_role;
