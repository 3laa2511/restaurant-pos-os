-- ==============================================================================
-- BO'SH STORE — PHASE 4.7 AUTHORITATIVE POS APPROVAL ROLE
-- Migration: 20260904_021_pos_approval_authoritative_role
-- Purpose:
--   Prevent a client-controlled cashier_role from bypassing manager approval.
--   The POS approval policy must use the persisted staff profile role instead.
-- ===============================================================================

CREATE OR REPLACE FUNCTION fn_atomic_pos_checkout(p_order_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_result JSONB;
  v_order_id UUID;
  v_order RECORD;
  v_approval_id UUID;
  v_discount NUMERIC(12,2);
  v_subtotal NUMERIC(12,2);
  v_discount_percent NUMERIC(12,4);
  v_cashier_id UUID;
  v_branch_id UUID;
  v_shift_id UUID;
  v_cashier_role TEXT;
  v_is_manager BOOLEAN;
  v_candidate_count INTEGER;
  v_profile_found BOOLEAN;
BEGIN
  -- The base function owns the authoritative order/stock/payment transaction.
  -- Any exception below rolls back that transaction, including the created order.
  v_order_result := fn_atomic_pos_checkout_base(p_order_payload);
  v_order_id := NULLIF(v_order_result->>'order_id', '')::UUID;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'ERR_ATOMIC_CHECKOUT_FAILED: POS checkout did not return an order ID';
  END IF;

  SELECT o.id, o.branch_id, o.cashier_id, o.shift_id, o.source,
         ROUND(COALESCE(o.subtotal, 0), 2) AS subtotal,
         ROUND(COALESCE(o.discount, 0), 2) AS discount,
         o.total
  INTO v_order
  FROM orders o
  WHERE o.id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ATOMIC_CHECKOUT_FAILED: Created POS order could not be reloaded';
  END IF;

  IF v_order.source NOT IN ('pos_cashier', 'pos_store') THEN
    RAISE EXCEPTION 'ERR_POS_SOURCE_REQUIRED: Approval policy can only run for POS transactions';
  END IF;

  v_branch_id := v_order.branch_id;
  v_cashier_id := NULLIF(v_order.cashier_id::TEXT, '')::UUID;
  v_shift_id := v_order.shift_id;
  v_subtotal := v_order.subtotal;
  v_discount := v_order.discount;

  IF v_branch_id IS NULL OR v_cashier_id IS NULL OR v_shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_POS_CONTEXT_REQUIRED: POS order must have branch, cashier and shift context';
  END IF;

  -- SECURITY BOUNDARY: never trust p_order_payload->>'cashier_role'.
  -- The role is resolved from the active staff profile bound to Supabase Auth.
  SELECT p.role::TEXT
  INTO v_cashier_role
  FROM profiles p
  WHERE p.user_id = v_cashier_id
    AND p.is_active = true
  LIMIT 1;

  IF v_cashier_role IS NULL THEN
    RAISE EXCEPTION 'ERR_CASHIER_PROFILE_REQUIRED: Active staff profile and role are required for POS checkout';
  END IF;

  v_is_manager := v_cashier_role IN ('owner', 'admin', 'store_manager', 'manager');

  -- Prevent a forged payload from changing the authoritative identity context.
  IF p_order_payload ? 'cashier_id'
     AND NULLIF(p_order_payload->>'cashier_id', '') IS NOT NULL
     AND (p_order_payload->>'cashier_id')::UUID <> v_cashier_id THEN
    RAISE EXCEPTION 'ERR_CASHIER_CONTEXT_MISMATCH: POS payload cashier does not match authoritative order cashier';
  END IF;

  IF v_discount < 0 OR v_discount > v_subtotal THEN
    RAISE EXCEPTION 'ERR_INVALID_DISCOUNT: Discount must be non-negative and cannot exceed authoritative subtotal';
  END IF;

  v_discount_percent := CASE WHEN v_subtotal > 0 THEN (v_discount / v_subtotal) * 100 ELSE 0 END;

  BEGIN
    v_approval_id := NULLIF(p_order_payload->>'approval_request_id', '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_APPROVAL_ID_INVALID: Approval request ID must be a valid UUID';
  END;

  IF v_approval_id IS NULL AND v_discount > 0 AND NOT v_is_manager
     AND (v_discount_percent > 10 OR v_discount > 200) THEN
    SELECT COUNT(*) INTO v_candidate_count
    FROM approval_requests ar
    WHERE ar.status = 'approved'
      AND ar.requested_by = v_cashier_id::TEXT
      AND ar.branch_id = v_branch_id
      AND (ar.shift_id IS NULL OR ar.shift_id = v_shift_id)
      AND ar.operation_type = 'DISCOUNT_APPLY'
      AND COALESCE(ar.entity_type, '') = 'Order'
      AND (ar.entity_id IS NULL OR ar.entity_id::TEXT = v_order_id::TEXT)
      AND (ar.expires_at IS NULL OR ar.expires_at > NOW())
      AND COALESCE(ar.requested_amount, 0) >= v_discount;

    IF v_candidate_count = 1 THEN
      SELECT ar.id INTO v_approval_id
      FROM approval_requests ar
      WHERE ar.status = 'approved'
        AND ar.requested_by = v_cashier_id::TEXT
        AND ar.branch_id = v_branch_id
        AND (ar.shift_id IS NULL OR ar.shift_id = v_shift_id)
        AND ar.operation_type = 'DISCOUNT_APPLY'
        AND COALESCE(ar.entity_type, '') = 'Order'
        AND (ar.entity_id IS NULL OR ar.entity_id::TEXT = v_order_id::TEXT)
        AND (ar.expires_at IS NULL OR ar.expires_at > NOW())
        AND COALESCE(ar.requested_amount, 0) >= v_discount
      ORDER BY ar.created_at ASC
      LIMIT 1
      FOR UPDATE;
    ELSIF v_candidate_count > 1 THEN
      RAISE EXCEPTION 'ERR_APPROVAL_AMBIGUOUS: Multiple eligible manager approvals exist for this cashier, shift and transaction';
    ELSE
      RAISE EXCEPTION 'ERR_MANAGER_APPROVAL_REQUIRED: Discount exceeds cashier approval threshold';
    END IF;
  END IF;

  IF v_approval_id IS NOT NULL THEN
    PERFORM fn_consume_approval_request(
      v_approval_id,
      v_cashier_id::VARCHAR,
      v_branch_id,
      v_shift_id,
      'DISCOUNT_APPLY',
      v_discount,
      v_order_id
    );
  END IF;

  RETURN v_order_result || jsonb_build_object(
    'approval_consumed', v_approval_id IS NOT NULL,
    'authoritative_subtotal', v_subtotal,
    'authoritative_discount', v_discount,
    'authoritative_discount_percent', ROUND(v_discount_percent, 2),
    'authoritative_cashier_role', v_cashier_role
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_pos_checkout(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_pos_checkout(JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_checkout(JSONB) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_atomic_pos_checkout'
      AND pg_get_function_identity_arguments(p.oid) = 'p_order_payload jsonb'
  ) THEN
    RAISE EXCEPTION 'ERR_MIGRATION_021: fn_atomic_pos_checkout was not installed';
  END IF;
END $$;
