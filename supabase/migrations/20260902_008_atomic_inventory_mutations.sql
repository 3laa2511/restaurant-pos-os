-- ==============================================================================
-- BO'SH STORE — ATOMIC INVENTORY MUTATIONS
-- Migration: 20260902_008_atomic_inventory_mutations
-- Purpose: eliminate read/modify/write races in manual inventory operations.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_atomic_inventory_mutation(
  p_product_id UUID,
  p_quantity_delta INT,
  p_movement_type VARCHAR(50),
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
  IF p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_STOCK_DELTA: Inventory mutation cannot have a zero quantity delta';
  END IF;

  IF p_movement_type NOT IN ('adjustment', 'purchase_received', 'sale', 'return') THEN
    RAISE EXCEPTION 'ERR_INVALID_MOVEMENT_TYPE: Unsupported inventory movement type %', p_movement_type;
  END IF;

  SELECT name, sku, stock_quantity
  INTO v_product_name, v_sku, v_current_stock
  FROM products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PRODUCT_NOT_FOUND: Product % does not exist', p_product_id;
  END IF;

  v_new_stock := v_current_stock + p_quantity_delta;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_STOCK: "%" has only % units available', v_product_name, v_current_stock;
  END IF;

  UPDATE products SET stock_quantity = v_new_stock, updated_at = NOW() WHERE id = p_product_id;

  INSERT INTO inventory_movements (
    product_id, product_name, sku, type, quantity,
    previous_quantity, resulting_quantity, reason,
    reference_type, reference_id, performed_by, created_at
  ) VALUES (
    p_product_id,
    v_product_name,
    v_sku,
    p_movement_type::inventory_movement_type_enum,
    p_quantity_delta,
    v_current_stock,
    v_new_stock,
    COALESCE(NULLIF(p_notes, ''), 'Atomic inventory mutation'),
    CASE p_movement_type
      WHEN 'sale' THEN 'order'
      WHEN 'purchase_received' THEN 'purchase_order'
      WHEN 'return' THEN 'return'
      ELSE 'manual_adjustment'
    END,
    p_reference_id,
    COALESCE(NULLIF(p_user_name, ''), COALESCE(p_user_id, 'System')),
    NOW()
  ) RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_name', v_product_name,
    'previous_stock', v_current_stock,
    'new_stock', v_new_stock,
    'quantity_delta', p_quantity_delta,
    'movement_id', v_movement_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_atomic_inventory_adjust(
  p_product_id UUID,
  p_new_quantity INT,
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
  v_product_name VARCHAR(255);
  v_sku VARCHAR(100);
  v_delta INT;
  v_movement_id UUID;
BEGIN
  IF p_new_quantity < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_STOCK: Stock quantity cannot be negative';
  END IF;

  SELECT name, sku, stock_quantity
  INTO v_product_name, v_sku, v_current_stock
  FROM products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PRODUCT_NOT_FOUND: Product % does not exist', p_product_id;
  END IF;

  v_delta := p_new_quantity - v_current_stock;
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'ERR_NO_STOCK_CHANGE: New stock quantity equals current quantity';
  END IF;

  UPDATE products SET stock_quantity = p_new_quantity, updated_at = NOW() WHERE id = p_product_id;

  INSERT INTO inventory_movements (
    product_id, product_name, sku, type, quantity,
    previous_quantity, resulting_quantity, reason,
    reference_type, reference_id, performed_by, created_at
  ) VALUES (
    p_product_id,
    v_product_name,
    v_sku,
    'adjustment',
    v_delta,
    v_current_stock,
    p_new_quantity,
    COALESCE(NULLIF(p_notes, ''), 'Manual stock adjustment'),
    'manual_adjustment',
    p_reference_id,
    COALESCE(NULLIF(p_user_name, ''), COALESCE(p_user_id, 'System')),
    NOW()
  ) RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_name', v_product_name,
    'previous_stock', v_current_stock,
    'new_stock', p_new_quantity,
    'quantity_delta', v_delta,
    'movement_id', v_movement_id
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_inventory_mutation(UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_inventory_adjust(UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_atomic_inventory_mutation(UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_atomic_inventory_adjust(UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT) TO service_role;
