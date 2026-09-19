-- ==============================================================================
-- BO'SH STORE — ATOMIC ORDER REPOSITORY CREATE
-- Migration: 20260915_044_atomic_order_repository_create
-- Purpose: prevent an orders-row / order_items-row split-brain when a generic
--          repository create path is used outside the checkout RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_atomic_order_repository_create(p_order_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID := COALESCE(NULLIF(p_order_payload->>'id', '')::UUID, gen_random_uuid());
  v_order_number VARCHAR(100);
  v_item RECORD;
  v_source TEXT;
BEGIN
  v_order_number := NULLIF(TRIM(p_order_payload->>'order_number'), '');
  IF v_order_number IS NULL THEN
    RAISE EXCEPTION 'ERR_ORDER_NUMBER_REQUIRED: order_number is required';
  END IF;

  v_source := COALESCE(NULLIF(p_order_payload->>'source', ''), 'online_store');

  IF EXISTS (SELECT 1 FROM orders WHERE order_number = v_order_number) THEN
    RAISE EXCEPTION 'ERR_ORDER_NUMBER_EXISTS: Order number % already exists', v_order_number;
  END IF;

  IF jsonb_typeof(p_order_payload->'items') <> 'array' OR jsonb_array_length(p_order_payload->'items') = 0 THEN
    RAISE EXCEPTION 'ERR_EMPTY_ORDER: Order must contain at least one item';
  END IF;

  INSERT INTO orders (
    id, order_number, source, customer_id, customer_name, customer_phone,
    customer_email, branch_id, subtotal, discount, coupon_code, shipping_fee,
    total, status, payment_method, payment_status, shipping_address, notes,
    tracking_number, inventory_deducted, assigned_driver_id, assigned_driver_name,
    created_at, updated_at
  ) VALUES (
    v_order_id,
    v_order_number,
    v_source,
    NULLIF(p_order_payload->>'customer_id', '')::UUID,
    COALESCE(p_order_payload->>'customer_name', 'Customer'),
    COALESCE(p_order_payload->>'customer_phone', ''),
    NULLIF(p_order_payload->>'customer_email', ''),
    NULLIF(p_order_payload->>'branch_id', '')::UUID,
    COALESCE((p_order_payload->>'subtotal')::NUMERIC, 0),
    COALESCE((p_order_payload->>'discount')::NUMERIC, 0),
    NULLIF(p_order_payload->>'coupon_code', ''),
    COALESCE((p_order_payload->>'shipping_fee')::NUMERIC, 0),
    COALESCE((p_order_payload->>'total')::NUMERIC, 0),
    COALESCE(NULLIF(p_order_payload->>'status', ''), 'pending')::order_status_enum,
    COALESCE(NULLIF(p_order_payload->>'payment_method', ''), 'cod')::payment_method_enum,
    COALESCE(NULLIF(p_order_payload->>'payment_status', ''), 'pending')::payment_status_enum,
    COALESCE((p_order_payload->>'shipping_address')::JSONB, '{}'::JSONB),
    NULLIF(p_order_payload->>'notes', ''),
    NULLIF(p_order_payload->>'tracking_number', ''),
    COALESCE((p_order_payload->>'inventory_deducted')::BOOLEAN, false),
    NULLIF(p_order_payload->>'assigned_driver_id', ''),
    NULLIF(p_order_payload->>'assigned_driver_name', ''),
    COALESCE((p_order_payload->>'created_at')::TIMESTAMPTZ, NOW()),
    COALESCE((p_order_payload->>'updated_at')::TIMESTAMPTZ, NOW())
  );

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_order_payload->'items') AS x(
      product_id UUID,
      product_name VARCHAR(255),
      sku VARCHAR(100),
      unit_price NUMERIC(12,2),
      cost_price NUMERIC(12,2),
      quantity INT,
      total NUMERIC(12,2),
      image TEXT,
      serial_number VARCHAR(150)
    )
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_ITEM: Order item quantity must be positive';
    END IF;

    INSERT INTO order_items (
      order_id, product_id, product_name, sku, unit_price, cost_price,
      quantity, total, image, serial_number
    ) VALUES (
      v_order_id, v_item.product_id, COALESCE(v_item.product_name, ''),
      COALESCE(v_item.sku, ''), COALESCE(v_item.unit_price, 0),
      COALESCE(v_item.cost_price, 0), v_item.quantity,
      COALESCE(v_item.total, 0), v_item.image, v_item.serial_number
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'existing', false,
    'order_id', v_order_id,
    'order_number', v_order_number
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_order_repository_create(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_order_repository_create(JSONB) FROM anon;
REVOKE ALL ON FUNCTION fn_atomic_order_repository_create(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_order_repository_create(JSONB) TO service_role;
