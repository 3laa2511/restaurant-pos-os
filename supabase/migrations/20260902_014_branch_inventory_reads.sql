-- ==============================================================================
-- BO'SH STORE — BRANCH INVENTORY READ API
-- Migration: 20260902_014_branch_inventory_reads
-- Purpose: expose branch-owned inventory quantities without leaking cross-branch rows.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_get_branch_inventory(
  p_branch_id UUID,
  p_product_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_BRANCH_REQUIRED: Branch is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND is_active = true) THEN
    RAISE EXCEPTION 'ERR_BRANCH_NOT_FOUND: Branch is not active';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'productId', p.id,
      'name', p.name,
      'nameAr', p.name_ar,
      'sku', p.sku,
      'barcode', p.barcode,
      'stockQuantity', COALESCE(bis.stock_quantity, 0),
      'costPrice', COALESCE(p.cost_price, 0),
      'retailPrice', p.price,
      'stockStatus', CASE
        WHEN COALESCE(bis.stock_quantity, 0) <= 0 THEN 'out_of_stock'
        WHEN COALESCE(bis.stock_quantity, 0) <= COALESCE(bis.low_stock_threshold, p.low_stock_threshold, 5) THEN 'low_stock'
        ELSE 'in_stock'
      END,
      'lowStockThreshold', COALESCE(bis.low_stock_threshold, p.low_stock_threshold, 5),
      'updatedAt', COALESCE(bis.updated_at, p.updated_at)
    ) ORDER BY p.name
  ), '[]'::jsonb)
  INTO v_result
  FROM products p
  LEFT JOIN branch_inventory_stock bis
    ON bis.product_id = p.id
   AND bis.branch_id = p_branch_id
  WHERE p_product_id IS NULL OR p.id = p_product_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION fn_get_branch_inventory(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_get_branch_inventory(UUID, UUID) TO service_role;
