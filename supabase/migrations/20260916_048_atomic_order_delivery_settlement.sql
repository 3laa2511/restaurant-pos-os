-- BO'SH STORE — ATOMIC DELIVERY + COD SETTLEMENT
-- Migration: 20260916_048_atomic_order_delivery_settlement

CREATE TABLE IF NOT EXISTS order_delivery_idempotency (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  actor_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION fn_atomic_order_delivery(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id UUID := NULLIF(TRIM(p_payload->>'order_id'), '')::UUID;
  v_actor_id VARCHAR(100) := NULLIF(TRIM(p_payload->>'actor_id'), '');
  v_actor_name VARCHAR(255) := COALESCE(NULLIF(TRIM(p_payload->>'actor_name'), ''), 'System');
  v_actor_role VARCHAR(50) := COALESCE(NULLIF(TRIM(p_payload->>'actor_role'), ''), 'system');
  v_actor_branch_id UUID := NULLIF(TRIM(p_payload->>'actor_branch_id'), '')::UUID;
  v_key VARCHAR(255) := COALESCE(NULLIF(TRIM(p_payload->>'idempotency_key'), ''), 'ORDER_DELIVER:' || v_order_id::text);
  v_order orders%ROWTYPE;
  v_existing order_delivery_idempotency%ROWTYPE;
  v_payment_id UUID;
  v_existing_paid BOOLEAN := false;
BEGIN
  IF v_order_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_DELIVERY_REQUEST: order_id and actor_id are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:order-deliver:' || v_order_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:order-deliver-key:' || v_key, 0));

  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = v_actor_id::UUID AND p.is_active = true AND p.role <> 'customer'
      AND ((p.permissions_override = true AND p.permissions ? 'orders.update')
        OR (p.permissions_override = false AND p.role IN ('owner','admin','store_manager','manager')))
  ) THEN
    RAISE EXCEPTION 'ERR_PERMISSION_DENIED: Staff account is not authorized to deliver orders';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_ORDER_NOT_FOUND: Order does not exist'; END IF;

  IF v_actor_branch_id IS NULL AND v_order.branch_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = v_actor_id::UUID AND role IN ('owner','admin') AND is_active = true) THEN
      RAISE EXCEPTION 'ERR_BRANCH_REQUIRED: Staff branch assignment is required for delivery';
    END IF;
  END IF;
  IF v_actor_branch_id IS NOT NULL AND (v_order.branch_id IS NULL OR v_order.branch_id <> v_actor_branch_id) THEN
    RAISE EXCEPTION 'ERR_BRANCH_SCOPE: Order belongs to another branch';
  END IF;

  INSERT INTO order_delivery_idempotency(idempotency_key, order_id, actor_id)
  VALUES (v_key, v_order_id, v_actor_id) ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT * INTO v_existing FROM order_delivery_idempotency WHERE idempotency_key = v_key FOR UPDATE;
  IF v_existing.order_id <> v_order_id THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REUSED: Delivery idempotency key is bound to another order';
  END IF;

  IF v_order.status::text = 'delivered' THEN
    RETURN jsonb_build_object('success', true, 'already_delivered', true, 'order_id', v_order_id, 'status', 'delivered');
  END IF;

  IF v_order.status::text NOT IN ('out_for_delivery','shipped','ready_for_shipping') THEN
    RAISE EXCEPTION 'ERR_INVALID_ORDER_TRANSITION: Order status % cannot be delivered', v_order.status;
  END IF;

  -- COD is settled here, inside the same transaction as delivery. Other payment
  -- methods must already be settled; delivery never fabricates a non-COD payment.
  IF v_order.payment_method::text IN ('cod', 'cash') AND v_order.payment_status::text <> 'paid' THEN
    SELECT EXISTS (SELECT 1 FROM payments WHERE order_id = v_order_id AND status = 'paid') INTO v_existing_paid;
    IF NOT v_existing_paid THEN
      INSERT INTO payments (order_id, amount, method, status, transaction_ref, paid_at, cash_amount, card_amount, wallet_amount, created_at)
      VALUES (v_order_id, v_order.total, 'cod', 'paid', 'COD-' || v_order_id::text, NOW(), v_order.total, 0, 0, NOW())
      RETURNING id INTO v_payment_id;
    END IF;
    UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = v_order_id;
  ELSIF v_order.payment_status::text <> 'paid' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_NOT_SETTLED: Non-COD order must have settled payment before delivery';
  END IF;

  UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = v_order_id;

  INSERT INTO order_status_history(order_id, previous_status, new_status, changed_by, note, created_at)
  VALUES (v_order_id, v_order.status, 'delivered', v_actor_name, 'Order delivered', NOW());

  INSERT INTO audit_logs(user_id, user_name, user_role, cashier_id, branch_id, action, entity, entity_id, previous_value, new_value, reason, financial_impact, risk_level, details, created_at)
  VALUES (
    v_actor_id, v_actor_name, v_actor_role, v_actor_id, v_order.branch_id,
    'DELIVER_ORDER', 'Order', v_order_id::text,
    jsonb_build_object('status', v_order.status, 'payment_status', v_order.payment_status)::text,
    jsonb_build_object('status', 'delivered', 'payment_status', 'paid')::text,
    'Order delivered', v_order.total, 'normal',
    'Delivery and any COD settlement committed atomically.', NOW()
  );

  RETURN jsonb_build_object('success', true, 'already_delivered', false, 'order_id', v_order_id, 'status', 'delivered', 'cod_payment_created', v_payment_id IS NOT NULL, 'payment_id', v_payment_id);
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_order_delivery(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_order_delivery(JSONB) TO service_role;
ALTER TABLE order_delivery_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_delivery_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON order_delivery_idempotency TO service_role;
