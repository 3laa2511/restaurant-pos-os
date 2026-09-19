-- ==============================================================================
-- BO'SH STORE — BRIDGE LEGACY INVENTORY RPCs TO BRANCH STOCK
-- Migration: 20260902_015_branch_inventory_rpc_bridge
-- Purpose: existing controller calls remain compatible while staff mutations
-- become branch-owned. Owner/admin retain global legacy inventory behavior.
-- ==============================================================================

ALTER FUNCTION fn_atomic_inventory_mutation(UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT)
  RENAME TO fn_atomic_inventory_mutation_legacy;

ALTER FUNCTION fn_atomic_inventory_adjust(UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT)
  RENAME TO fn_atomic_inventory_adjust_legacy;

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
  v_branch_id UUID;
  v_role TEXT;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT branch_id, role::text INTO v_branch_id, v_role
    FROM profiles WHERE user_id::text = p_user_id LIMIT 1;
  END IF;

  IF v_branch_id IS NOT NULL AND COALESCE(v_role, '') NOT IN ('owner', 'admin') THEN
    RETURN fn_branch_inventory_mutation(
      v_branch_id, p_product_id, p_quantity_delta, p_movement_type,
      p_user_id, p_user_name, p_reference_id, p_notes
    );
  END IF;

  RETURN fn_atomic_inventory_mutation_legacy(
    p_product_id, p_quantity_delta, p_movement_type,
    p_user_id, p_user_name, p_reference_id, p_notes
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
  v_branch_id UUID;
  v_role TEXT;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT branch_id, role::text INTO v_branch_id, v_role
    FROM profiles WHERE user_id::text = p_user_id LIMIT 1;
  END IF;

  IF v_branch_id IS NOT NULL AND COALESCE(v_role, '') NOT IN ('owner', 'admin') THEN
    RETURN fn_branch_inventory_adjust(
      v_branch_id, p_product_id, p_new_quantity,
      p_user_id, p_user_name, p_reference_id, p_notes
    );
  END IF;

  RETURN fn_atomic_inventory_adjust_legacy(
    p_product_id, p_new_quantity,
    p_user_id, p_user_name, p_reference_id, p_notes
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_inventory_mutation(UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_inventory_adjust(UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_atomic_inventory_mutation(UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_atomic_inventory_adjust(UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT) TO service_role;

REVOKE ALL ON FUNCTION fn_atomic_inventory_mutation_legacy(UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_inventory_adjust_legacy(UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_atomic_inventory_mutation_legacy(UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_atomic_inventory_adjust_legacy(UUID, INT, VARCHAR, VARCHAR, VARCHAR, TEXT) TO service_role;
