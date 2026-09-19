-- ============================================================================
-- BO'SH STORE — INITIAL BRANCH OWNERSHIP BACKFILL
-- Existing single-store data is assigned to MAIN so branch-scoped staff do not
-- silently lose legacy records. Future records must receive branch ownership
-- through trusted server-side identity/resource relationships.
-- ============================================================================

DO $$
DECLARE
  v_main_branch UUID;
BEGIN
  SELECT id INTO v_main_branch FROM branches WHERE code = 'MAIN' LIMIT 1;

  IF v_main_branch IS NULL THEN
    RAISE EXCEPTION 'MAIN branch must exist before branch backfill';
  END IF;

  UPDATE profiles SET branch_id = v_main_branch WHERE branch_id IS NULL;
  UPDATE warehouses SET branch_id = v_main_branch WHERE branch_id IS NULL;
  UPDATE orders SET branch_id = v_main_branch WHERE branch_id IS NULL;
  UPDATE repair_tickets SET branch_id = v_main_branch WHERE branch_id IS NULL;
  UPDATE gaming_stations SET branch_id = v_main_branch WHERE branch_id IS NULL;
  UPDATE gaming_sessions SET branch_id = v_main_branch WHERE branch_id IS NULL;
  UPDATE gaming_reservations SET branch_id = v_main_branch WHERE branch_id IS NULL;
  UPDATE inventory_movements SET branch_id = v_main_branch WHERE branch_id IS NULL;
  UPDATE stocktake_records SET branch_id = v_main_branch WHERE branch_id IS NULL;
END;
$$;
