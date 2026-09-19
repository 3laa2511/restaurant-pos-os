-- ==============================================================================
-- BO'SH STORE — ATOMIC DATABASE TRANSACTIONS & RPCS
-- Schema-aligned implementation. All writes use row locks and roll back as one
-- PostgreSQL transaction when any statement fails.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_deduct_inventory_atomic(
  p_product_id UUID,
  p_quantity INT,
  p_movement_type VARCHAR(50) DEFAULT 'sale',
  p_user_id VARCHAR(100) DEFAULT NULL,
  p_user_name VARCHAR(255) DEFAULT 'System',
  p_reference_id VARCHAR(100) DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_stock INT;
  v_new_stock INT;
  v_product_name VARCHAR(255);
  v_sku VARCHAR(100);
  v_movement_id UUID;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'ERR_INVALID_QUANTITY: Quantity must be positive'; END IF;
  IF p_movement_type NOT IN ('sale', 'return', 'adjustment', 'purchase_received') THEN
    RAISE EXCEPTION 'ERR_INVALID_MOVEMENT_TYPE: Unsupported movement type %', p_movement_type;
  END IF;

  SELECT name, sku, stock_quantity INTO v_product_name, v_sku, v_current_stock
  FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_PRODUCT_NOT_FOUND: Product % does not exist', p_product_id; END IF;

  v_new_stock := CASE WHEN p_movement_type = 'sale' THEN v_current_stock - p_quantity ELSE v_current_stock + p_quantity END;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_STOCK: "%" has only % units available', v_product_name, v_current_stock;
  END IF;

  UPDATE products SET stock_quantity = v_new_stock, updated_at = NOW() WHERE id = p_product_id;
  INSERT INTO inventory_movements (
    product_id, product_name, sku, type, quantity, previous_quantity,
    resulting_quantity, reason, reference_type, reference_id, performed_by, created_at
  ) VALUES (
    p_product_id, v_product_name, v_sku, p_movement_type::inventory_movement_type_enum,
    CASE WHEN p_movement_type = 'sale' THEN -p_quantity ELSE p_quantity END,
    v_current_stock, v_new_stock, COALESCE(NULLIF(p_notes, ''), 'Atomic inventory mutation'),
    CASE WHEN p_movement_type = 'sale' THEN 'order' ELSE p_movement_type END,
    p_reference_id, COALESCE(NULLIF(p_user_name, ''), COALESCE(p_user_id, 'System')), NOW()
  ) RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object('success', true, 'product_id', p_product_id,
    'product_name', v_product_name, 'previous_stock', v_current_stock,
    'new_stock', v_new_stock, 'movement_id', v_movement_id);
END;
$$;

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
  v_product_name VARCHAR(255);
  v_sku VARCHAR(100);
  v_cost_price NUMERIC(12,2);
  v_unit_price NUMERIC(12,2);
  v_serial VARCHAR(150);
  v_serial_status VARCHAR(50);
  v_total NUMERIC(12,2);
  v_paid_amount NUMERIC(12,2);
BEGIN
  v_order_number := NULLIF(TRIM(p_order_payload->>'order_number'), '');
  IF v_order_number IS NULL THEN
    v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTRING(v_order_id::text, 1, 8);
  END IF;

  SELECT id, total INTO v_order_id, v_total FROM orders WHERE order_number = v_order_number;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'existing', true, 'order_id', v_order_id,
      'order_number', v_order_number, 'total', v_total,
      'payment_status', (SELECT payment_status::text FROM orders WHERE id = v_order_id));
  END IF;

  IF jsonb_typeof(p_order_payload->'items') <> 'array' OR jsonb_array_length(p_order_payload->'items') = 0 THEN
    RAISE EXCEPTION 'ERR_EMPTY_ORDER: Order must contain at least one item';
  END IF;

  v_customer_id := NULLIF(p_order_payload->>'customer_id', '')::UUID;
  v_total := COALESCE((p_order_payload->>'total')::NUMERIC, 0);
  v_paid_amount := COALESCE((p_order_payload->>'paid_amount')::NUMERIC, 0);
  IF v_total < 0 OR v_paid_amount < 0 THEN RAISE EXCEPTION 'ERR_INVALID_TOTALS: Monetary values cannot be negative'; END IF;

  INSERT INTO orders (
    id, order_number, source, customer_id, customer_name, customer_phone, customer_email,
    subtotal, discount, coupon_code, shipping_fee, total, status, payment_method,
    payment_status, shipping_address, notes, created_at, updated_at
  ) VALUES (
    v_order_id, v_order_number, COALESCE(NULLIF(p_order_payload->>'source', ''), 'online_store'),
    v_customer_id, COALESCE(p_order_payload->>'customer_name', 'Customer'),
    COALESCE(p_order_payload->>'customer_phone', ''), NULLIF(p_order_payload->>'customer_email', ''),
    COALESCE((p_order_payload->>'subtotal')::NUMERIC, 0), COALESCE((p_order_payload->>'discount')::NUMERIC, 0),
    NULLIF(p_order_payload->>'coupon_code', ''), COALESCE((p_order_payload->>'shipping_fee')::NUMERIC, 0), v_total,
    COALESCE(NULLIF(p_order_payload->>'status', ''), 'confirmed')::order_status_enum,
    COALESCE(NULLIF(p_order_payload->>'payment_method', ''), 'cod')::payment_method_enum,
    COALESCE(NULLIF(p_order_payload->>'payment_status', ''), 'pending')::payment_status_enum,
    COALESCE((p_order_payload->>'shipping_address')::JSONB, '{}'::JSONB),
    NULLIF(p_order_payload->>'notes', ''), NOW(), NOW()
  );

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_payload->'items') AS x(
    product_id UUID, quantity INT, serial_number VARCHAR(150), selected_serial VARCHAR(150)
  ) LOOP
    IF v_item.product_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_ITEM: Every order item requires a positive quantity and product_id';
    END IF;

    SELECT name, sku, cost_price, price, stock_quantity
    INTO v_product_name, v_sku, v_cost_price, v_unit_price, v_current_stock
    FROM products WHERE id = v_item.product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ERR_PRODUCT_NOT_FOUND: Item product % not found', v_item.product_id; END IF;
    IF v_current_stock < v_item.quantity THEN
      RAISE EXCEPTION 'ERR_INSUFFICIENT_STOCK: "%" has only % units remaining (requested %)', v_product_name, v_current_stock, v_item.quantity;
    END IF;

    v_serial := COALESCE(v_item.serial_number, v_item.selected_serial);
    IF v_serial IS NOT NULL AND v_serial <> '' THEN
      SELECT status INTO v_serial_status FROM serialized_devices
      WHERE serial_number = v_serial AND product_id = v_item.product_id FOR UPDATE;
      IF NOT FOUND OR v_serial_status <> 'in_stock' THEN
        RAISE EXCEPTION 'ERR_SERIAL_UNAVAILABLE: Serial number "%" is not available for this product', v_serial;
      END IF;
      UPDATE serialized_devices SET status = 'sold', customer_id = v_customer_id,
        customer_name = p_order_payload->>'customer_name', customer_phone = p_order_payload->>'customer_phone',
        sold_at = NOW(), order_id = v_order_id, order_number = v_order_number, updated_at = NOW()
      WHERE serial_number = v_serial AND product_id = v_item.product_id;
    END IF;

    v_new_stock := v_current_stock - v_item.quantity;
    UPDATE products SET stock_quantity = v_new_stock, updated_at = NOW() WHERE id = v_item.product_id;

    INSERT INTO order_items (
      order_id, product_id, product_name, sku, unit_price, cost_price, quantity, total, image, serial_number
    ) VALUES (
      v_order_id, v_item.product_id, v_product_name, v_sku, v_unit_price, v_cost_price,
      v_item.quantity, v_unit_price * v_item.quantity, NULL, v_serial
    );

    INSERT INTO inventory_movements (
      product_id, product_name, sku, type, quantity, previous_quantity, resulting_quantity,
      reason, reference_type, reference_id, performed_by, created_at
    ) VALUES (
      v_item.product_id, v_product_name, v_sku, 'sale', -v_item.quantity, v_current_stock, v_new_stock,
      'Sale via Order #' || v_order_number, 'order', v_order_id::text,
      COALESCE(NULLIF(p_order_payload->>'cashier_name', ''), 'Online Store'), NOW()
    );
  END LOOP;

  IF v_paid_amount > 0 THEN
    INSERT INTO payments (order_id, amount, method, status, transaction_ref, paid_at, created_at)
    VALUES (
      v_order_id, v_paid_amount,
      COALESCE(NULLIF(p_order_payload->>'payment_method', ''), 'cod')::payment_method_enum,
      COALESCE(NULLIF(p_order_payload->>'payment_status', ''), 'pending')::payment_status_enum,
      'TXN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTRING(gen_random_uuid()::text, 1, 8), NOW(), NOW()
    );
  END IF;

  INSERT INTO audit_logs (user_id, user_name, user_role, action, entity, entity_id, new_value, details, created_at)
  VALUES (
    NULLIF(p_order_payload->>'cashier_id', ''),
    COALESCE(NULLIF(p_order_payload->>'cashier_name', ''), 'Online Store'),
    COALESCE(NULLIF(p_order_payload->>'cashier_role', ''), 'system'),
    'CREATE_ORDER', 'orders', v_order_id::text,
    jsonb_build_object('order_number', v_order_number, 'total', v_total)::text,
    'Atomic checkout completed for Order #' || v_order_number, NOW()
  );

  RETURN jsonb_build_object('success', true, 'existing', false, 'order_id', v_order_id,
    'order_number', v_order_number, 'total', v_total,
    'payment_status', p_order_payload->>'payment_status');
END;
$$;
