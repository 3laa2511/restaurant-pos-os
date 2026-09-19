-- ==============================================================================
-- BO'SH STORE — CHECKOUT + CRM TRANSACTION BOUNDARY
-- Migration: 20260915_045_checkout_crm_transaction_boundary
-- Purpose: keep the customer CRM mutation inside the same PostgreSQL transaction
--          as the already-atomic order checkout. A successful checkout RPC must
--          not be followed by a second customer write that can fail independently.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_atomic_checkout_with_crm(p_order_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_order_id UUID;
  v_total NUMERIC(12,2);
  v_customer_id UUID;
  v_phone VARCHAR(50);
  v_name VARCHAR(255);
  v_email VARCHAR(255);
  v_governorate VARCHAR(100);
  v_city VARCHAR(100);
  v_address TEXT;
  v_points INT;
BEGIN
  v_result := fn_atomic_checkout(p_order_payload);

  IF COALESCE((v_result->>'existing')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  v_order_id := NULLIF(v_result->>'order_id', '')::UUID;
  v_total := COALESCE((v_result->>'total')::NUMERIC, 0);
  v_phone := NULLIF(TRIM(p_order_payload->>'customer_phone'), '');

  IF v_phone IS NULL THEN
    RETURN v_result;
  END IF;

  v_name := COALESCE(NULLIF(TRIM(p_order_payload->>'customer_name'), ''), 'Customer');
  v_email := NULLIF(TRIM(p_order_payload->>'customer_email'), '');
  v_governorate := COALESCE(NULLIF(TRIM(p_order_payload->>'governorate'), ''), 'Cairo');
  v_city := COALESCE(NULLIF(TRIM(p_order_payload->>'city'), ''), 'Cairo');
  v_address := COALESCE(NULLIF(TRIM(p_order_payload->>'street_address'), ''), '');
  v_customer_id := NULLIF(p_order_payload->>'customer_id', '')::UUID;
  v_points := FLOOR(v_total / 100)::INT;

  INSERT INTO customers (
    id, name, phone, email, governorate, city, address,
    loyalty_points, total_spent, orders_count, repairs_count,
    gaming_hours, tier, tags, notes, last_active_at, created_at, updated_at
  ) VALUES (
    COALESCE(v_customer_id, gen_random_uuid()),
    v_name, v_phone, v_email, v_governorate, v_city, v_address,
    v_points, v_total, 1, 0, 0, 'bronze', '{}', NULL,
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

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION fn_atomic_pos_checkout_with_crm(p_order_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_total NUMERIC(12,2);
  v_customer_id UUID;
  v_phone VARCHAR(50);
  v_name VARCHAR(255);
  v_email VARCHAR(255);
  v_governorate VARCHAR(100);
  v_city VARCHAR(100);
  v_address TEXT;
  v_points INT;
BEGIN
  v_result := fn_atomic_pos_checkout(p_order_payload);

  IF COALESCE((v_result->>'existing')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  v_total := COALESCE((v_result->>'total')::NUMERIC, 0);
  v_phone := NULLIF(TRIM(p_order_payload->>'customer_phone'), '');
  IF v_phone IS NULL THEN
    RETURN v_result;
  END IF;

  v_name := COALESCE(NULLIF(TRIM(p_order_payload->>'customer_name'), ''), 'Customer');
  v_email := NULLIF(TRIM(p_order_payload->>'customer_email'), '');
  v_governorate := COALESCE(NULLIF(TRIM(p_order_payload->>'governorate'), ''), 'Cairo');
  v_city := COALESCE(NULLIF(TRIM(p_order_payload->>'city'), ''), 'Cairo');
  v_address := COALESCE(NULLIF(TRIM(p_order_payload->>'street_address'), ''), '');
  v_customer_id := NULLIF(p_order_payload->>'customer_id', '')::UUID;
  v_points := FLOOR(v_total / 100)::INT;

  INSERT INTO customers (
    id, name, phone, email, governorate, city, address,
    loyalty_points, total_spent, orders_count, repairs_count,
    gaming_hours, tier, tags, notes, last_active_at, created_at, updated_at
  ) VALUES (
    COALESCE(v_customer_id, gen_random_uuid()),
    v_name, v_phone, v_email, v_governorate, v_city, v_address,
    v_points, v_total, 1, 0, 0, 'bronze', '{}', NULL,
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

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_checkout_with_crm(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_checkout_with_crm(JSONB) FROM anon;
REVOKE ALL ON FUNCTION fn_atomic_checkout_with_crm(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_checkout_with_crm(JSONB) TO service_role;

REVOKE ALL ON FUNCTION fn_atomic_pos_checkout_with_crm(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_pos_checkout_with_crm(JSONB) FROM anon;
REVOKE ALL ON FUNCTION fn_atomic_pos_checkout_with_crm(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_checkout_with_crm(JSONB) TO service_role;
