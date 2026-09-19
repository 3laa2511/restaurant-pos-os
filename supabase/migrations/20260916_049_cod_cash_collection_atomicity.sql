-- BO'SH STORE — COD CASH COLLECTION ATOMICITY
-- Migration: 20260916_049_cod_cash_collection_atomicity
-- Purpose: keep delivery status separate from cash collection. COD settlement
--          must be bound to an open cashier shift and post through the existing
--          payment -> financial-ledger transaction boundary.

CREATE TABLE IF NOT EXISTS order_cod_collection_idempotency (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  cashier_id UUID NOT NULL,
  payment_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_order_cod_collection_one_order
  ON order_cod_collection_idempotency(order_id);

CREATE OR REPLACE FUNCTION fn_atomic_order_delivery(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id UUID := NULLIF(TRIM(p_payload->>'order_id'), '')::UUID;
  v_actor_id UUID := NULLIF(TRIM(p_payload->>'actor_id'), '')::UUID;
  v_actor_name VARCHAR(255) := COALESCE(NULLIF(TRIM(p_payload->>'actor_name'), ''), 'System');
  v_actor_role VARCHAR(50) := COALESCE(NULLIF(TRIM(p_payload->>'actor_role'), ''), 'system');
  v_actor_branch_id UUID := NULLIF(TRIM(p_payload->>'actor_branch_id'), '')::UUID;
  v_key VARCHAR(255) := COALESCE(NULLIF(TRIM(p_payload->>'idempotency_key'), ''), 'ORDER_DELIVER:' || v_order_id::text);
  v_order orders%ROWTYPE;
  v_existing order_delivery_idempotency%ROWTYPE;
BEGIN
  IF v_order_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_DELIVERY_REQUEST: order_id and actor_id are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:order-deliver:' || v_order_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:order-deliver-key:' || v_key, 0));

  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = v_actor_id AND p.is_active = true AND p.role <> 'customer'
      AND ((p.permissions_override = true AND p.permissions ? 'orders.update')
        OR (p.permissions_override = false AND p.role IN ('owner','admin','store_manager','manager')))
  ) THEN
    RAISE EXCEPTION 'ERR_PERMISSION_DENIED: Staff account is not authorized to deliver orders';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_ORDER_NOT_FOUND: Order does not exist'; END IF;

  IF v_actor_branch_id IS NULL AND v_order.branch_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = v_actor_id AND role IN ('owner','admin') AND is_active = true) THEN
      RAISE EXCEPTION 'ERR_BRANCH_REQUIRED: Staff branch assignment is required for delivery';
    END IF;
  END IF;
  IF v_actor_branch_id IS NOT NULL AND (v_order.branch_id IS NULL OR v_order.branch_id <> v_actor_branch_id) THEN
    RAISE EXCEPTION 'ERR_BRANCH_SCOPE: Order belongs to another branch';
  END IF;

  INSERT INTO order_delivery_idempotency(idempotency_key, order_id, actor_id)
  VALUES (v_key, v_order_id, v_actor_id::text) ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT * INTO v_existing FROM order_delivery_idempotency WHERE idempotency_key = v_key FOR UPDATE;
  IF v_existing.order_id <> v_order_id THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REUSED: Delivery idempotency key is bound to another order';
  END IF;

  IF v_order.status::text = 'delivered' THEN
    RETURN jsonb_build_object('success', true, 'already_delivered', true, 'order_id', v_order_id, 'status', 'delivered', 'payment_status', v_order.payment_status);
  END IF;

  IF v_order.status::text NOT IN ('out_for_delivery','shipped','ready_for_shipping') THEN
    RAISE EXCEPTION 'ERR_INVALID_ORDER_TRANSITION: Order status % cannot be delivered', v_order.status;
  END IF;

  -- Delivery does NOT settle COD. Cash collection is a separate cashier event
  -- because financial settlement must be bound to an open shift/cashier and
  -- then flow through the authoritative payment/ledger triggers.
  IF v_order.payment_status::text <> 'paid' AND v_order.payment_method::text NOT IN ('cod','cash') THEN
    RAISE EXCEPTION 'ERR_PAYMENT_NOT_SETTLED: Non-COD order must have settled payment before delivery';
  END IF;

  UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = v_order_id;

  INSERT INTO order_status_history(order_id, previous_status, new_status, changed_by, note, created_at)
  VALUES (v_order_id, v_order.status, 'delivered', v_actor_name, 'Order delivered; payment settlement is handled separately when applicable', NOW());

  INSERT INTO audit_logs(user_id, user_name, user_role, cashier_id, branch_id, action, entity, entity_id, previous_value, new_value, reason, financial_impact, risk_level, details, created_at)
  VALUES (
    v_actor_id::text, v_actor_name, v_actor_role, NULL, v_order.branch_id,
    'DELIVER_ORDER', 'Order', v_order_id::text,
    jsonb_build_object('status', v_order.status, 'payment_status', v_order.payment_status)::text,
    jsonb_build_object('status', 'delivered', 'payment_status', v_order.payment_status)::text,
    'Order delivered', 0, 'normal',
    'Delivery state committed atomically. COD cash settlement is intentionally a separate cashier transaction.', NOW()
  );

  RETURN jsonb_build_object('success', true, 'already_delivered', false, 'order_id', v_order_id, 'status', 'delivered', 'cod_payment_created', false, 'payment_status', v_order.payment_status);
END;
$$;

CREATE OR REPLACE FUNCTION fn_atomic_cod_cash_collection(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id UUID := NULLIF(TRIM(p_payload->>'order_id'), '')::UUID;
  v_cashier_id UUID := NULLIF(TRIM(p_payload->>'cashier_id'), '')::UUID;
  v_branch_id UUID := NULLIF(TRIM(p_payload->>'branch_id'), '')::UUID;
  v_key VARCHAR(255) := NULLIF(TRIM(p_payload->>'idempotency_key'), '');
  v_cash_tendered NUMERIC(12,2) := NULLIF(TRIM(p_payload->>'cash_tendered'), '')::NUMERIC;
  v_order orders%ROWTYPE;
  v_shift cash_drawer_shifts%ROWTYPE;
  v_existing order_cod_collection_idempotency%ROWTYPE;
  v_payment_id UUID;
  v_change NUMERIC(12,2);
BEGIN
  IF v_order_id IS NULL OR v_cashier_id IS NULL OR v_branch_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_COD_COLLECTION_REQUEST: order_id, cashier_id, branch_id and idempotency_key are required';
  END IF;
  IF v_cash_tendered IS NULL OR v_cash_tendered <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_CASH_TENDERED: Cash tendered must be greater than zero';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:cod-collect-order:' || v_order_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:cod-collect-key:' || v_key, 0));

  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = v_cashier_id AND p.is_active = true AND p.role <> 'customer'
      AND ((p.permissions_override = true AND p.permissions ? 'pos.access')
        OR (p.permissions_override = false AND p.role IN ('owner','admin','store_manager','manager','cashier')))
  ) THEN
    RAISE EXCEPTION 'ERR_PERMISSION_DENIED: Cashier account is not authorized to collect COD cash';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_ORDER_NOT_FOUND: Order does not exist'; END IF;
  IF v_order.branch_id IS NULL OR v_order.branch_id <> v_branch_id THEN
    RAISE EXCEPTION 'ERR_BRANCH_SCOPE: Order belongs to another branch';
  END IF;
  IF v_order.payment_method::text NOT IN ('cod','cash') THEN
    RAISE EXCEPTION 'ERR_NOT_COD_ORDER: Only COD/cash orders can use COD cash collection';
  END IF;
  IF v_order.payment_status::text = 'paid' THEN
    SELECT * INTO v_existing FROM order_cod_collection_idempotency
    WHERE order_id = v_order_id ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object('success', true, 'already_collected', true, 'order_id', v_order_id, 'payment_id', v_existing.payment_id);
  END IF;
  IF v_order.status::text NOT IN ('delivered','out_for_delivery','shipped','ready_for_shipping') THEN
    RAISE EXCEPTION 'ERR_INVALID_COD_COLLECTION_STATE: Order is not in a collectible delivery state';
  END IF;

  SELECT * INTO v_shift FROM cash_drawer_shifts
  WHERE branch_id = v_branch_id AND cashier_id = v_cashier_id AND status = 'open'
  LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: An open cashier shift is required for COD cash collection';
  END IF;

  INSERT INTO order_cod_collection_idempotency(idempotency_key, order_id, cashier_id)
  VALUES (v_key, v_order_id, v_cashier_id)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT * INTO v_existing FROM order_cod_collection_idempotency WHERE idempotency_key = v_key FOR UPDATE;
  IF v_existing.order_id <> v_order_id OR v_existing.cashier_id <> v_cashier_id THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REUSED: COD collection idempotency key is bound to another operation';
  END IF;
  IF v_existing.payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_collected', true, 'order_id', v_order_id, 'payment_id', v_existing.payment_id, 'shift_id', v_shift.id);
  END IF;

  IF v_cash_tendered < v_order.total THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_CASH_TENDER: Cash tendered % is below order total %', v_cash_tendered, v_order.total;
  END IF;
  v_change := ROUND((v_cash_tendered - v_order.total) * 100) / 100;

  -- Bind the authoritative order settlement context before inserting the paid
  -- payment. The existing financial trigger then posts the sale ledger using
  -- this exact branch/shift/cashier context inside the same transaction.
  UPDATE orders SET payment_status = 'paid', shift_id = v_shift.id, cashier_id = v_cashier_id, updated_at = NOW()
  WHERE id = v_order_id;

  INSERT INTO payments (
    order_id, amount, method, status, transaction_ref, idempotency_key, paid_at,
    cash_amount, card_amount, wallet_amount, cash_tendered, change_amount, created_at
  ) VALUES (
    v_order_id, v_order.total, 'cod', 'paid', 'COD-' || v_order_id::text, v_key, NOW(),
    v_order.total, 0, 0, v_cash_tendered, v_change, NOW()
  ) RETURNING id INTO v_payment_id;

  INSERT INTO cash_drawer_movements(shift_id, branch_id, cashier_id, type, amount, reason, reference_type, reference_id)
  VALUES (v_shift.id, v_branch_id, v_cashier_id, 'sale_cash', v_order.total, 'COD cash collected for Order #' || v_order.order_number, 'order', v_order_id);

  UPDATE cash_drawer_shifts SET expected_cash = expected_cash + v_order.total, updated_at = NOW()
  WHERE id = v_shift.id;

  UPDATE order_cod_collection_idempotency SET payment_id = v_payment_id WHERE idempotency_key = v_key;

  INSERT INTO audit_logs(user_id, user_name, user_role, cashier_id, branch_id, action, entity, entity_id, previous_value, new_value, reason, financial_impact, risk_level, details, created_at)
  SELECT v_cashier_id::text, p.name, p.role::text, v_cashier_id, v_branch_id,
    'COLLECT_COD_CASH', 'Order', v_order_id::text,
    jsonb_build_object('payment_status', 'pending', 'shift_id', NULL)::text,
    jsonb_build_object('payment_status', 'paid', 'shift_id', v_shift.id, 'payment_id', v_payment_id, 'cash_amount', v_order.total, 'cash_tendered', v_cash_tendered, 'change_amount', v_change)::text,
    'COD cash collection', v_order.total, 'normal',
    'COD settlement, payment, financial ledger trigger, cash drawer movement and audit committed atomically.', NOW()
  FROM profiles p WHERE p.user_id = v_cashier_id LIMIT 1;

  RETURN jsonb_build_object('success', true, 'already_collected', false, 'order_id', v_order_id, 'payment_id', v_payment_id, 'shift_id', v_shift.id, 'cash_amount', v_order.total, 'cash_tendered', v_cash_tendered, 'change_amount', v_change);
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_order_delivery(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_order_delivery(JSONB) TO service_role;
REVOKE ALL ON FUNCTION fn_atomic_cod_cash_collection(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_cod_cash_collection(JSONB) TO service_role;

ALTER TABLE order_cod_collection_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_cod_collection_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON order_cod_collection_idempotency TO service_role;
