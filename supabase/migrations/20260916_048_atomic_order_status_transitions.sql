-- ==============================================================================
-- BO'SH STORE — ATOMIC ORDER STATUS TRANSITIONS
-- Migration: 20260916_048_atomic_order_status_transitions
-- Purpose: make confirm/ship lifecycle transitions authoritative in PostgreSQL.
--          Payment settlement is intentionally excluded; delivery remains on its
--          existing path until COD settlement is bound to the financial ledger.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_atomic_order_status_transition(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID := NULLIF(TRIM(p_payload->>'order_id'), '')::UUID;
  v_actor_id VARCHAR(100) := NULLIF(TRIM(p_payload->>'actor_id'), '');
  v_actor_name VARCHAR(255) := COALESCE(NULLIF(TRIM(p_payload->>'actor_name'), ''), 'System');
  v_actor_role VARCHAR(50) := COALESCE(NULLIF(TRIM(p_payload->>'actor_role'), ''), 'system');
  v_actor_branch_id UUID := NULLIF(TRIM(p_payload->>'actor_branch_id'), '')::UUID;
  v_target TEXT := NULLIF(TRIM(p_payload->>'target_status'), '');
  v_tracking_number VARCHAR(100) := NULLIF(TRIM(p_payload->>'tracking_number'), '');
  v_note TEXT := COALESCE(NULLIF(TRIM(p_payload->>'note'), ''), '');
  v_order orders%ROWTYPE;
BEGIN
  IF v_order_id IS NULL OR v_actor_id IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_STATUS_TRANSITION_REQUEST: order_id, actor_id and target_status are required';
  END IF;

  IF v_target NOT IN ('confirmed', 'shipped') THEN
    RAISE EXCEPTION 'ERR_INVALID_STATUS_TRANSITION_REQUEST: unsupported lifecycle target %', v_target;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:order-status:' || v_order_id::text, 0));

  IF NOT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = v_actor_id::UUID
      AND p.is_active = true
      AND p.role <> 'customer'
      AND (
        (p.permissions_override = true AND p.permissions ? 'orders.update')
        OR
        (p.permissions_override = false AND p.role IN ('owner','admin','store_manager','manager'))
      )
  ) THEN
    RAISE EXCEPTION 'ERR_PERMISSION_DENIED: Staff account is not authorized to change order status';
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ORDER_NOT_FOUND: Order does not exist';
  END IF;

  IF v_actor_branch_id IS NULL AND v_order.branch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles
      WHERE user_id = v_actor_id::UUID
        AND role IN ('owner','admin')
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'ERR_BRANCH_REQUIRED: Staff branch assignment is required';
    END IF;
  END IF;

  IF v_actor_branch_id IS NOT NULL AND (v_order.branch_id IS NULL OR v_order.branch_id <> v_actor_branch_id) THEN
    RAISE EXCEPTION 'ERR_BRANCH_SCOPE: Order belongs to another branch';
  END IF;

  IF v_target = 'confirmed' AND v_order.status::text <> 'pending' THEN
    RAISE EXCEPTION 'ERR_INVALID_ORDER_TRANSITION: Only pending orders can be confirmed';
  END IF;

  IF v_target = 'shipped' AND v_order.status::text NOT IN ('processing','preparing','ready_for_shipping') THEN
    RAISE EXCEPTION 'ERR_INVALID_ORDER_TRANSITION: Order status % cannot transition to shipped', v_order.status;
  END IF;

  UPDATE orders
  SET status = v_target::order_status_enum,
      tracking_number = CASE WHEN v_target = 'shipped' THEN COALESCE(v_tracking_number, tracking_number) ELSE tracking_number END,
      updated_at = NOW()
  WHERE id = v_order_id;

  INSERT INTO order_status_history(order_id, previous_status, new_status, changed_by, note, created_at)
  VALUES (v_order_id, v_order.status, v_target::order_status_enum, v_actor_name, v_note, NOW());

  INSERT INTO audit_logs(
    user_id, user_name, user_role, cashier_id, branch_id,
    action, entity, entity_id, previous_value, new_value,
    reason, financial_impact, risk_level, details, created_at
  ) VALUES (
    v_actor_id, v_actor_name, v_actor_role, v_actor_id, v_order.branch_id,
    'UPDATE_ORDER_STATUS', 'Order', v_order_id::text,
    jsonb_build_object('status', v_order.status)::text,
    jsonb_build_object('status', v_target, 'tracking_number', v_tracking_number)::text,
    v_note, 0, 'normal',
    'Order lifecycle status transition committed atomically.', NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'previous_status', v_order.status,
    'status', v_target,
    'tracking_number', v_tracking_number
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_order_status_transition(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_order_status_transition(JSONB) TO service_role;

COMMENT ON FUNCTION fn_atomic_order_status_transition(JSONB) IS 'Authoritative atomic confirm/ship order lifecycle transition with locking, branch scope, history and audit.';
