-- ==============================================================================
-- BO'SH STORE — BRANCH-SCOPED INVENTORY STOCK
-- Migration: 20260902_013_branch_inventory_stock
-- Purpose: make inventory quantities branch-owned instead of sharing products.stock_quantity.
-- Legacy MAIN stock is backfilled from products.stock_quantity.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS branch_inventory_stock (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold INT NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (branch_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_inventory_stock_product
  ON branch_inventory_stock(product_id);

CREATE INDEX IF NOT EXISTS idx_branch_inventory_stock_branch
  ON branch_inventory_stock(branch_id);

INSERT INTO branch_inventory_stock (branch_id, product_id, stock_quantity, low_stock_threshold)
SELECT b.id, p.id, GREATEST(COALESCE(p.stock_quantity, 0), 0), GREATEST(COALESCE(p.low_stock_threshold, 5), 0)
FROM branches b
CROSS JOIN products p
WHERE b.code = 'MAIN'
ON CONFLICT (branch_id, product_id) DO NOTHING;

-- Keep this compatibility trigger for legacy code that still writes products.stock_quantity.
-- New branch-aware paths must use branch_inventory_stock and the branch RPCs below.
CREATE OR REPLACE FUNCTION touch_branch_inventory_stock_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branch_inventory_stock_updated_at ON branch_inventory_stock;
CREATE TRIGGER trg_branch_inventory_stock_updated_at
BEFORE UPDATE ON branch_inventory_stock
FOR EACH ROW EXECUTE FUNCTION touch_branch_inventory_stock_updated_at();

CREATE OR REPLACE FUNCTION fn_branch_inventory_mutation(
  p_branch_id UUID,
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
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_BRANCH_REQUIRED: Branch is required for inventory mutation';
  END IF;

  IF p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_STOCK_DELTA: Inventory mutation cannot have a zero quantity delta';
  END IF;

  IF p_movement_type NOT IN ('adjustment', 'purchase_received', 'sale', 'return') THEN
    RAISE EXCEPTION 'ERR_INVALID_MOVEMENT_TYPE: Unsupported inventory movement type %', p_movement_type;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND is_active = true) THEN
    RAISE EXCEPTION 'ERR_BRANCH_NOT_FOUND: Branch is not active';
  END IF;

  SELECT name, sku INTO v_product_name, v_sku
  FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PRODUCT_NOT_FOUND: Product % does not exist', p_product_id;
  END IF;

  INSERT INTO branch_inventory_stock (branch_id, product_id, stock_quantity)
  VALUES (p_branch_id, p_product_id, 0)
  ON CONFLICT (branch_id, product_id) DO NOTHING;

  SELECT stock_quantity INTO v_current_stock
  FROM branch_inventory_stock
  WHERE branch_id = p_branch_id AND product_id = p_product_id
  FOR UPDATE;

  v_new_stock := v_current_stock + p_quantity_delta;
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_STOCK: "%" has only % units available in this branch', v_product_name, v_current_stock;
  END IF;

  UPDATE branch_inventory_stock
  SET stock_quantity = v_new_stock
  WHERE branch_id = p_branch_id AND product_id = p_product_id;

  INSERT INTO inventory_movements (
    product_id, product_name, sku, type, quantity,
    previous_quantity, resulting_quantity, reason,
    reference_type, reference_id, performed_by, branch_id, created_at
  ) VALUES (
    p_product_id, v_product_name, v_sku,
    p_movement_type::inventory_movement_type_enum, p_quantity_delta,
    v_current_stock, v_new_stock,
    COALESCE(NULLIF(p_notes, ''), 'Branch inventory mutation'),
    CASE p_movement_type
      WHEN 'sale' THEN 'order'
      WHEN 'purchase_received' THEN 'purchase_order'
      WHEN 'return' THEN 'return'
      ELSE 'manual_adjustment'
    END,
    p_reference_id,
    COALESCE(NULLIF(p_user_name, ''), COALESCE(p_user_id, 'System')),
    p_branch_id,
    NOW()
  ) RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', p_branch_id,
    'product_id', p_product_id,
    'product_name', v_product_name,
    'previous_stock', v_current_stock,
    'new_stock', v_new_stock,
    'quantity_delta', p_quantity_delta,
    'movement_id', v_movement_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION fn_branch_inventory_adjust(
  p_branch_id UUID,
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
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_BRANCH_REQUIRED: Branch is required for inventory adjustment';
  END IF;
  IF p_new_quantity < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_STOCK: Stock quantity cannot be negative';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND is_active = true) THEN
    RAISE EXCEPTION 'ERR_BRANCH_NOT_FOUND: Branch is not active';
  END IF;

  SELECT name, sku INTO v_product_name, v_sku FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PRODUCT_NOT_FOUND: Product % does not exist', p_product_id;
  END IF;

  INSERT INTO branch_inventory_stock (branch_id, product_id, stock_quantity)
  VALUES (p_branch_id, p_product_id, 0)
  ON CONFLICT (branch_id, product_id) DO NOTHING;

  SELECT stock_quantity INTO v_current_stock
  FROM branch_inventory_stock
  WHERE branch_id = p_branch_id AND product_id = p_product_id
  FOR UPDATE;

  v_delta := p_new_quantity - v_current_stock;
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'ERR_NO_STOCK_CHANGE: New stock quantity equals current branch quantity';
  END IF;

  UPDATE branch_inventory_stock
  SET stock_quantity = p_new_quantity
  WHERE branch_id = p_branch_id AND product_id = p_product_id;

  INSERT INTO inventory_movements (
    product_id, product_name, sku, type, quantity,
    previous_quantity, resulting_quantity, reason,
    reference_type, reference_id, performed_by, branch_id, created_at
  ) VALUES (
    p_product_id, v_product_name, v_sku, 'adjustment', v_delta,
    v_current_stock, p_new_quantity,
    COALESCE(NULLIF(p_notes, ''), 'Branch stock adjustment'),
    'manual_adjustment', p_reference_id,
    COALESCE(NULLIF(p_user_name, ''), COALESCE(p_user_id, 'System')),
    p_branch_id, NOW()
  ) RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'success', true,
    'branch_id', p_branch_id,
    'product_id', p_product_id,
    'product_name', v_product_name,
    'previous_stock', v_current_stock,
    'new_stock', p_new_quantity,
    'quantity_delta', v_delta,
    'movement_id', v_movement_id
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_branch_inventory_mutation(UUID, UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_branch_inventory_adjust(UUID, UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_branch_inventory_mutation(UUID, UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_branch_inventory_adjust(UUID, UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT) TO service_role;

REVOKE ALL ON TABLE branch_inventory_stock FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE branch_inventory_stock TO service_role;
