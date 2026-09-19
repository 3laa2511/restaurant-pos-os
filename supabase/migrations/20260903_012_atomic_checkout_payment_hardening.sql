-- ==============================================================================
-- BO'SH STORE — ATOMIC CHECKOUT PAYMENT HARDENING
-- Migration: 20260903_012_atomic_checkout_payment_hardening
-- Purpose: make POS payment settlement authoritative and atomic.
-- ==============================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS cash_tendered NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS change_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_amount_positive;

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

ALTER TABLE payments
  ADD CONSTRAINT payments_breakdown_nonnegative CHECK (
    cash_amount >= 0 AND card_amount >= 0 AND wallet_amount >= 0
    AND cash_tendered >= 0 AND change_amount >= 0
  );

CREATE OR REPLACE FUNCTION fn_atomic_checkout(p_order_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID := gen_random_uuid();
  v_order_number VARCHAR(100);
  v_customer_id UUID;
  v_item RECORD;
  v_current_stock INT;
  v_new_stock INT;
  v_prod_name VARCHAR(255);
  v_prod_sku VARCHAR(100);
  v_cost_price NUMERIC(12,2);
  v_serial_status VARCHAR(50);
  v_subtotal NUMERIC(12,2) := 0;
  v_discount NUMERIC(12,2) := 0;
  v_shipping NUMERIC(12,2) := 0;
  v_total NUMERIC(12,2) := 0;
  v_paid_amount NUMERIC(12,2) := 0;
  v_line_total NUMERIC(12,2);
  v_source TEXT := COALESCE(NULLIF(p_order_payload->>'source', ''), 'online_store');
  v_method payment_method_enum;
  v_payment_status payment_status_enum;
  v_cash_tendered NUMERIC(12,2) := COALESCE((p_order_payload->>'cash_tendered')::NUMERIC, 0);
  v_cash_amount NUMERIC(12,2) := COALESCE((p_order_payload->>'cash_amount')::NUMERIC, 0);
  v_card_amount NUMERIC(12,2) := COALESCE((p_order_payload->>'card_amount')::NUMERIC, 0);
  v_wallet_amount NUMERIC(12,2) := COALESCE((p_order_payload->>'wallet_amount')::NUMERIC, 0);
  v_change_amount NUMERIC(12,2) := 0;
  v_breakdown_total NUMERIC(12,2) := 0;
BEGIN
  v_order_number := NULLIF(TRIM(p_order_payload->>'order_number'), '');
  IF v_order_number IS NULL THEN
    v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTRING(v_order_id::text, 1, 8);
  END IF;

  -- Safe idempotent retry: the same POS attempt returns the already-created order.
  SELECT id, total INTO v_order_id, v_total
  FROM orders
  WHERE order_number = v_order_number;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'existing', true,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'total', v_total,
      'payment_status', (SELECT payment_status::text FROM orders WHERE id = v_order_id)
    );
  END IF;

  IF jsonb_typeof(p_order_payload->'items') <> 'array' OR jsonb_array_length(p_order_payload->'items') = 0 THEN
    RAISE EXCEPTION 'ERR_EMPTY_ORDER: Order must contain at least one item';
  END IF;

  v_method := COALESCE(NULLIF(p_order_payload->>'payment_method', ''), 'cod')::payment_method_enum;

  IF v_cash_tendered < 0 OR v_cash_amount < 0 OR v_card_amount < 0 OR v_wallet_amount < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_PAYMENT: Payment values cannot be negative';
  END IF;

  IF p_order_payload->>'customer_id' IS NOT NULL AND p_order_payload->>'customer_id' <> '' THEN
    v_customer_id := (p_order_payload->>'customer_id')::UUID;
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_order_payload->'items') AS x(
      product_id UUID,
      quantity INT,
      serial_number VARCHAR(150),
      selected_serial VARCHAR(150)
    )
  LOOP
    IF v_item.product_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_ITEM: Every order item requires a positive quantity and product_id';
    END IF;

    SELECT name, sku, cost_price, price, stock_quantity
    INTO v_prod_name, v_prod_sku, v_cost_price, v_line_total, v_current_stock
    FROM products
    WHERE id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_PRODUCT_NOT_FOUND: Item product % not found', v_item.product_id;
    END IF;

    IF v_current_stock < v_item.quantity THEN
      RAISE EXCEPTION 'ERR_INSUFFICIENT_STOCK: "%" has only % units remaining (requested %)', v_prod_name, v_current_stock, v_item.quantity;
    END IF;

    v_line_total := v_line_total * v_item.quantity;
    v_subtotal := v_subtotal + v_line_total;

    IF COALESCE(v_item.serial_number, v_item.selected_serial) IS NOT NULL
       AND COALESCE(v_item.serial_number, v_item.selected_serial) <> '' THEN
      SELECT status INTO v_serial_status
      FROM serialized_devices
      WHERE serial_number = COALESCE(v_item.serial_number, v_item.selected_serial)
        AND product_id = v_item.product_id
      FOR UPDATE;

      IF NOT FOUND OR v_serial_status <> 'in_stock' THEN
        RAISE EXCEPTION 'ERR_SERIAL_UNAVAILABLE: Serial number "%" is not available for this product', COALESCE(v_item.serial_number, v_item.selected_serial);
      END IF;

      UPDATE serialized_devices
      SET status = 'sold', customer_id = v_customer_id,
          customer_name = p_order_payload->>'customer_name',
          customer_phone = p_order_payload->>'customer_phone',
          sold_at = NOW(), order_id = v_order_id,
          order_number = v_order_number, updated_at = NOW()
      WHERE serial_number = COALESCE(v_item.serial_number, v_item.selected_serial)
        AND product_id = v_item.product_id;
    END IF;

    v_new_stock := v_current_stock - v_item.quantity;
    UPDATE products SET stock_quantity = v_new_stock, updated_at = NOW() WHERE id = v_item.product_id;

    INSERT INTO order_items (
      order_id, product_id, product_name, sku, unit_price, cost_price,
      quantity, total, image, serial_number
    ) VALUES (
      v_order_id, v_item.product_id, v_prod_name, v_prod_sku,
      v_line_total / v_item.quantity, v_cost_price, v_item.quantity,
      v_line_total, NULL, COALESCE(v_item.serial_number, v_item.selected_serial)
    );

    INSERT INTO inventory_movements (
      product_id, product_name, sku, type, quantity,
      previous_quantity, resulting_quantity, reason,
      reference_type, reference_id, performed_by, created_at
    ) VALUES (
      v_item.product_id, v_prod_name, v_prod_sku, 'sale', -v_item.quantity,
      v_current_stock, v_new_stock, 'Sale via Order #' || v_order_number,
      'order', v_order_id::text,
      COALESCE(NULLIF(p_order_payload->>'cashier_name', ''), 'Online Store'), NOW()
    );
  END LOOP;

  v_discount := LEAST(COALESCE((p_order_payload->>'discount')::NUMERIC, 0), v_subtotal);
  v_shipping := GREATEST(COALESCE((p_order_payload->>'shipping_fee')::NUMERIC, 0), 0);
  v_total := GREATEST(0, v_subtotal - v_discount + v_shipping);

  IF v_source IN ('pos_cashier', 'pos_store') THEN
    IF v_method = 'pos_cash' THEN
      IF v_cash_tendered < v_total THEN
        RAISE EXCEPTION 'ERR_INSUFFICIENT_TENDER: Cash tendered % is below authoritative total %', v_cash_tendered, v_total;
      END IF;
      v_cash_amount := v_total;
      v_paid_amount := v_total;
      v_change_amount := v_cash_tendered - v_total;
      v_payment_status := 'paid';
    ELSIF v_method IN ('card', 'wallet', 'instapay') THEN
      v_cash_tendered := 0;
      v_cash_amount := 0;
      v_card_amount := CASE WHEN v_method = 'card' THEN v_total ELSE 0 END;
      v_wallet_amount := CASE WHEN v_method IN ('wallet', 'instapay') THEN v_total ELSE 0 END;
      v_breakdown_total := v_card_amount + v_wallet_amount;
      IF ABS(v_breakdown_total - v_total) > 0.01 THEN
        RAISE EXCEPTION 'ERR_PAYMENT_MISMATCH: Payment breakdown % does not equal authoritative total %', v_breakdown_total, v_total;
      END IF;
      v_paid_amount := v_total;
      v_payment_status := 'paid';
    ELSIF v_method = 'mixed' THEN
      v_breakdown_total := v_cash_amount + v_card_amount + v_wallet_amount;
      IF ABS(v_breakdown_total - v_total) > 0.01 THEN
        RAISE EXCEPTION 'ERR_PAYMENT_MISMATCH: Mixed payment % does not equal authoritative total %', v_breakdown_total, v_total;
      END IF;
      IF v_cash_tendered < v_cash_amount THEN
        RAISE EXCEPTION 'ERR_INSUFFICIENT_TENDER: Cash tendered % is below cash portion %', v_cash_tendered, v_cash_amount;
      END IF;
      v_change_amount := v_cash_tendered - v_cash_amount;
      v_paid_amount := v_total;
      v_payment_status := 'paid';
    ELSE
      RAISE EXCEPTION 'ERR_INVALID_POS_PAYMENT_METHOD: Payment method % is not valid for POS settlement', v_method;
    END IF;
  ELSE
    v_paid_amount := CASE WHEN COALESCE(NULLIF(p_order_payload->>'payment_status', ''), 'pending') = 'paid' THEN v_total ELSE 0 END;
    v_payment_status := COALESCE(NULLIF(p_order_payload->>'payment_status', ''), 'pending')::payment_status_enum;
  END IF;

  INSERT INTO orders (
    id, order_number, source, customer_id, customer_name, customer_phone,
    customer_email, subtotal, discount, coupon_code, shipping_fee, total,
    status, payment_method, payment_status, shipping_address, notes, created_at, updated_at
  ) VALUES (
    v_order_id, v_order_number, v_source, v_customer_id,
    COALESCE(p_order_payload->>'customer_name', 'Customer'),
    COALESCE(p_order_payload->>'customer_phone', ''),
    NULLIF(p_order_payload->>'customer_email', ''),
    v_subtotal, v_discount, NULLIF(p_order_payload->>'coupon_code', ''), v_shipping, v_total,
    COALESCE(NULLIF(p_order_payload->>'status', ''), 'confirmed')::order_status_enum,
    v_method, v_payment_status,
    COALESCE((p_order_payload->>'shipping_address')::JSONB, '{}'::JSONB),
    NULLIF(p_order_payload->>'notes', ''), NOW(), NOW()
  );

  IF v_paid_amount > 0 THEN
    INSERT INTO payments (
      order_id, amount, method, status, transaction_ref, paid_at,
      cash_amount, card_amount, wallet_amount, cash_tendered, change_amount, created_at
    ) VALUES (
      v_order_id, v_paid_amount, v_method, v_payment_status,
      'TXN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTRING(gen_random_uuid()::text, 1, 8),
      NOW(), v_cash_amount, v_card_amount, v_wallet_amount,
      v_cash_tendered, v_change_amount, NOW()
    );
  END IF;

  INSERT INTO audit_logs (
    user_id, user_name, user_role, action, entity, entity_id,
    new_value, details, created_at
  ) VALUES (
    NULLIF(p_order_payload->>'cashier_id', ''),
    COALESCE(NULLIF(p_order_payload->>'cashier_name', ''), 'Online Store'),
    COALESCE(NULLIF(p_order_payload->>'cashier_role', ''), 'system'),
    'CREATE_ORDER', 'orders', v_order_id::text,
    jsonb_build_object(
      'order_number', v_order_number,
      'total', v_total,
      'payment_method', v_method,
      'paid_amount', v_paid_amount,
      'cash_amount', v_cash_amount,
      'card_amount', v_card_amount,
      'wallet_amount', v_wallet_amount,
      'cash_tendered', v_cash_tendered,
      'change_amount', v_change_amount
    )::text,
    'Atomic checkout completed for Order #' || v_order_number,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'existing', false,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total', v_total,
    'payment_status', v_payment_status,
    'paid_amount', v_paid_amount,
    'cash_tendered', v_cash_tendered,
    'change_amount', v_change_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_checkout(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_atomic_checkout(JSONB) TO service_role;
