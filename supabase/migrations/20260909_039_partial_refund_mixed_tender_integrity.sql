-- ==============================================================================
-- BO'SH STORE — PARTIAL REFUND + MIXED-TENDER REFUND INTEGRITY
-- Migration: 20260909_039_partial_refund_mixed_tender_integrity
-- Purpose: add a dedicated, atomic item-level POS refund path without changing
--          the existing full-refund lifecycle.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS pos_refund_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  shift_id UUID NOT NULL,
  cashier_id UUID NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cash_amount >= 0),
  card_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (card_amount >= 0),
  wallet_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (wallet_amount >= 0),
  reason TEXT,
  idempotency_key VARCHAR(255) NOT NULL,
  approval_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status = 'completed'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pos_refund_settlement_tender_total CHECK (
    ROUND((cash_amount + card_amount + wallet_amount) * 100) = ROUND(amount * 100)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_refund_settlement_idempotency
  ON pos_refund_settlements(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_pos_refund_settlement_order
  ON pos_refund_settlements(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_refund_settlement_shift
  ON pos_refund_settlements(shift_id, branch_id, created_at);

CREATE TABLE IF NOT EXISTS pos_refund_settlement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id UUID NOT NULL REFERENCES pos_refund_settlements(id) ON DELETE RESTRICT,
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INT NOT NULL CHECK (quantity > 0),
  refund_amount NUMERIC(12,2) NOT NULL CHECK (refund_amount > 0),
  cogs NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cogs >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_refund_item_once_per_settlement
  ON pos_refund_settlement_items(refund_id, order_item_id);
CREATE INDEX IF NOT EXISTS idx_pos_refund_items_order_item
  ON pos_refund_settlement_items(order_item_id);

ALTER TABLE pos_refund_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_refund_settlement_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_refund_settlements, pos_refund_settlement_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE pos_refund_settlements, pos_refund_settlement_items TO service_role;

CREATE OR REPLACE FUNCTION fn_atomic_pos_partial_refund(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_branch_id UUID;
  v_cashier_id UUID;
  v_shift_id UUID;
  v_approval_id UUID;
  v_idempotency_key TEXT;
  v_reason TEXT;
  v_order orders%ROWTYPE;
  v_payment RECORD;
  v_sale financial_transactions%ROWTYPE;
  v_shift cash_drawer_shifts%ROWTYPE;
  v_item RECORD;
  v_refund_id UUID;
  v_refund_amount NUMERIC(12,2) := 0;
  v_cogs NUMERIC(12,2) := 0;
  v_paid_total NUMERIC(12,2) := 0;
  v_prior_refunded NUMERIC(12,2) := 0;
  v_remaining NUMERIC(12,2) := 0;
  v_cash_amount NUMERIC(12,2) := 0;
  v_card_amount NUMERIC(12,2) := 0;
  v_wallet_amount NUMERIC(12,2) := 0;
  v_tender_residual NUMERIC(12,2) := 0;
  v_discount_factor NUMERIC(18,10) := 1;
  v_item_refund NUMERIC(12,2);
  v_prior_item_qty INT;
  v_requested_item_count INT;
  v_distinct_item_count INT;
  v_is_manager BOOLEAN := false;
  v_role TEXT;
  v_high_threshold NUMERIC(12,4);
  v_critical_threshold NUMERIC(12,4);
  v_item_payload JSONB;
  v_cash_movement_id UUID;
  v_ledger_id UUID;
BEGIN
  v_order_id := NULLIF(p_payload->>'order_id', '')::UUID;
  v_branch_id := NULLIF(p_payload->>'branch_id', '')::UUID;
  v_cashier_id := NULLIF(p_payload->>'cashier_id', '')::UUID;
  v_shift_id := NULLIF(p_payload->>'shift_id', '')::UUID;
  v_approval_id := NULLIF(p_payload->>'approval_id', '')::UUID;
  v_idempotency_key := NULLIF(TRIM(p_payload->>'idempotency_key'), '');
  v_reason := COALESCE(NULLIF(TRIM(p_payload->>'reason'), ''), 'POS partial refund');

  IF v_order_id IS NULL OR v_branch_id IS NULL OR v_cashier_id IS NULL OR v_shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_CONTEXT_REQUIRED: Order, branch, cashier and shift are required';
  END IF;
  IF v_idempotency_key IS NULL OR LENGTH(v_idempotency_key) > 255 THEN
    RAISE EXCEPTION 'ERR_REFUND_IDEMPOTENCY_KEY_REQUIRED: A valid Idempotency-Key is required for partial refunds';
  END IF;
  IF jsonb_typeof(p_payload->'refund_items') <> 'array' OR jsonb_array_length(p_payload->'refund_items') = 0 THEN
    RAISE EXCEPTION 'ERR_PARTIAL_REFUND_ITEMS_REQUIRED: At least one refund item is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:partial-refund:' || v_idempotency_key, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:financial-order:' || v_order_id::TEXT, 0));

  SELECT * INTO v_refund_id
  FROM pos_refund_settlements
  WHERE idempotency_key = v_idempotency_key
  LIMIT 1;
  IF v_refund_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'success', true, 'existing', true, 'refund_id', prs.id, 'order_id', prs.order_id,
      'refund_amount', prs.amount, 'cash_refund_amount', prs.cash_amount,
      'card_refund_amount', prs.card_amount, 'wallet_refund_amount', prs.wallet_amount,
      'shift_id', prs.shift_id, 'idempotency_key', prs.idempotency_key
    ) INTO v_item_payload
    FROM pos_refund_settlements prs WHERE prs.id = v_refund_id;
    RETURN v_item_payload;
  END IF;

  SELECT * INTO v_shift
  FROM cash_drawer_shifts
  WHERE id = v_shift_id AND branch_id = v_branch_id AND cashier_id = v_cashier_id AND status = 'open'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_REQUIRED: An open cash drawer shift is required for POS partial refund';
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = v_order_id AND branch_id = v_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REFUND_ORDER_NOT_FOUND: POS order was not found in this branch';
  END IF;
  IF v_order.source NOT IN ('pos_cashier', 'pos_store') THEN
    RAISE EXCEPTION 'ERR_POS_REFUND_REQUIRED: Only POS orders can use the POS refund settlement path';
  END IF;
  IF v_order.status = 'returned' OR v_order.payment_status = 'refunded' THEN
    RAISE EXCEPTION 'ERR_ALREADY_REFUNDED: This order has already been fully refunded';
  END IF;

  SELECT COUNT(*)::INT, COUNT(DISTINCT order_item_id)::INT
  INTO v_requested_item_count, v_distinct_item_count
  FROM jsonb_to_recordset(p_payload->'refund_items') AS x(order_item_id UUID, quantity INT);
  IF v_requested_item_count <> v_distinct_item_count THEN
    RAISE EXCEPTION 'ERR_DUPLICATE_REFUND_ITEM: The same order item cannot appear more than once';
  END IF;

  SELECT
    COALESCE(SUM(amount), 0)::NUMERIC(12,2),
    COALESCE(SUM(cash_amount), 0)::NUMERIC(12,2),
    COALESCE(SUM(card_amount), 0)::NUMERIC(12,2),
    COALESCE(SUM(wallet_amount), 0)::NUMERIC(12,2)
  INTO v_paid_total, v_cash_amount, v_card_amount, v_wallet_amount
  FROM payments
  WHERE order_id = v_order_id AND status = 'paid';
  IF v_paid_total <= 0 THEN
    RAISE EXCEPTION 'ERR_REFUND_PAYMENT_NOT_SETTLED: No settled POS payment is available for refund';
  END IF;

  SELECT * INTO v_sale
  FROM financial_transactions
  WHERE type = 'revenue' AND reference_id = v_order_id::TEXT
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_SALE_NOT_FOUND: Settled POS sale ledger is required before a partial refund';
  END IF;
  IF ROUND(v_sale.amount * 100) <> ROUND(v_paid_total * 100) THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_PAYMENT_MISMATCH: Settled payment total does not match the sale ledger';
  END IF;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2)
  INTO v_prior_refunded
  FROM pos_refund_settlements
  WHERE order_id = v_order_id AND status = 'completed';
  v_remaining := ROUND((v_paid_total - v_prior_refunded) * 100) / 100;
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'ERR_REFUND_LIMIT_EXCEEDED: No refundable balance remains on this order';
  END IF;

  IF v_order.subtotal > 0 AND v_order.discount > 0 THEN
    v_discount_factor := GREATEST(0, 1 - (v_order.discount / v_order.subtotal));
  END IF;

  -- Validate all requested quantities and derive refund values exclusively from
  -- persisted order-item facts. No client-supplied price is trusted.
  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_payload->'refund_items') AS x(order_item_id UUID, quantity INT)
  LOOP
    IF v_item.order_item_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_REFUND_ITEM: Refund item requires a positive quantity and order_item_id';
    END IF;

    SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price, oi.total, oi.cost_price, oi.serial_number
    INTO v_item
    FROM order_items oi
    WHERE oi.id = v_item.order_item_id AND oi.order_id = v_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_REFUND_ITEM_NOT_FOUND: Refund item does not belong to this order';
    END IF;
    IF v_item.quantity <= 0 OR v_item.quantity > v_item.quantity THEN
      RAISE EXCEPTION 'ERR_REFUND_QUANTITY_INVALID: Requested refund quantity exceeds the sold quantity';
    END IF;

    SELECT COALESCE(SUM(prsi.quantity), 0)::INT
    INTO v_prior_item_qty
    FROM pos_refund_settlement_items prsi
    JOIN pos_refund_settlements prs ON prs.id = prsi.refund_id
    WHERE prsi.order_item_id = v_item.id AND prs.status = 'completed';
    IF v_item.quantity > (v_item.quantity - v_prior_item_qty) THEN
      RAISE EXCEPTION 'ERR_REFUND_QUANTITY_EXCEEDED: Refund quantity exceeds the remaining refundable quantity for item %', v_item.id;
    END IF;

    IF v_item.serial_number IS NOT NULL AND v_item.quantity <> 1 THEN
      RAISE EXCEPTION 'ERR_SERIAL_REFUND_QUANTITY_INVALID: Serialized items can only be refunded one unit at a time';
    END IF;

    v_item_refund := ROUND((v_item.unit_price * v_item.quantity * v_discount_factor) * 100) / 100;
    IF v_item_refund <= 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_REFUND_AMOUNT: Calculated item refund must be greater than zero';
    END IF;
    v_refund_amount := ROUND((v_refund_amount + v_item_refund) * 100) / 100;
    v_cogs := ROUND((v_cogs + (v_item.cost_price * v_item.quantity)) * 100) / 100;
  END LOOP;

  IF v_refund_amount > v_remaining THEN
    RAISE EXCEPTION 'ERR_REFUND_LIMIT_EXCEEDED: Requested refund % exceeds remaining refundable balance %', v_refund_amount, v_remaining;
  END IF;

  SELECT p.role::TEXT INTO v_role
  FROM profiles p
  WHERE (p.user_id = v_cashier_id OR p.id = v_cashier_id) AND p.is_active = true
  ORDER BY CASE WHEN p.user_id = v_cashier_id THEN 0 ELSE 1 END
  LIMIT 1;
  v_is_manager := COALESCE(v_role IN ('owner', 'admin', 'store_manager', 'manager'), false);

  SELECT fn_get_effective_numeric_policy('REFUND_HIGH_THRESHOLD', v_branch_id),
         fn_get_effective_numeric_policy('REFUND_CRITICAL_THRESHOLD', v_branch_id)
  INTO v_high_threshold, v_critical_threshold;
  IF v_high_threshold IS NULL OR v_critical_threshold IS NULL THEN
    RAISE EXCEPTION 'ERR_ACCOUNTABILITY_POLICY_UNAVAILABLE: Required refund policies are missing';
  END IF;
  IF v_refund_amount >= v_high_threshold AND NOT v_is_manager AND v_approval_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_APPROVAL_REQUIRED: High-value POS partial refunds require manager approval';
  END IF;
  IF v_approval_id IS NOT NULL THEN
    PERFORM fn_consume_approval_request(
      v_approval_id, v_cashier_id::VARCHAR, v_branch_id, v_shift_id,
      'REFUND_ORDER', v_refund_amount, v_order_id
    );
  END IF;

  -- Allocate the refund against the original authoritative mixed-tender sale.
  -- Largest-tender residual absorbs the final cent so buckets always reconcile.
  IF v_sale.amount <= 0 THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_SALE_INVALID: Original sale amount must be positive';
  END IF;
  v_cash_amount := ROUND(v_sale.cash_amount * (v_refund_amount / v_sale.amount) * 100) / 100;
  v_card_amount := ROUND(v_sale.card_amount * (v_refund_amount / v_sale.amount) * 100) / 100;
  v_wallet_amount := ROUND(v_sale.wallet_amount * (v_refund_amount / v_sale.amount) * 100) / 100;
  v_tender_residual := ROUND((v_refund_amount - (v_cash_amount + v_card_amount + v_wallet_amount)) * 100) / 100;
  IF v_tender_residual <> 0 THEN
    IF v_sale.cash_amount >= v_sale.card_amount AND v_sale.cash_amount >= v_sale.wallet_amount THEN
      v_cash_amount := v_cash_amount + v_tender_residual;
    ELSIF v_sale.card_amount >= v_sale.wallet_amount THEN
      v_card_amount := v_card_amount + v_tender_residual;
    ELSE
      v_wallet_amount := v_wallet_amount + v_tender_residual;
    END IF;
  END IF;
  IF v_cash_amount < 0 OR v_card_amount < 0 OR v_wallet_amount < 0
     OR ROUND((v_cash_amount + v_card_amount + v_wallet_amount) * 100) <> ROUND(v_refund_amount * 100) THEN
    RAISE EXCEPTION 'ERR_REFUND_TENDER_ALLOCATION_INVALID: Refund tender allocation does not equal refund amount';
  END IF;
  IF v_cash_amount > v_shift.expected_cash THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_DRAWER_CASH: Drawer does not contain enough expected cash for this refund';
  END IF;

  INSERT INTO pos_refund_settlements (
    order_id, branch_id, shift_id, cashier_id, amount, cash_amount,
    card_amount, wallet_amount, reason, idempotency_key, approval_id
  ) VALUES (
    v_order_id, v_branch_id, v_shift_id, v_cashier_id, v_refund_amount,
    v_cash_amount, v_card_amount, v_wallet_amount, v_reason, v_idempotency_key, v_approval_id
  ) RETURNING id INTO v_refund_id;

  -- Re-read request rows for mutation after the settlement record exists.
  FOR v_item IN
    SELECT x.order_item_id, x.quantity
    FROM jsonb_to_recordset(p_payload->'refund_items') AS x(order_item_id UUID, quantity INT)
  LOOP
    SELECT oi.* INTO v_item
    FROM order_items oi
    WHERE oi.id = v_item.order_item_id AND oi.order_id = v_order_id
    FOR UPDATE;

    v_item_refund := ROUND((v_item.unit_price * v_item.quantity * v_discount_factor) * 100) / 100;

    INSERT INTO pos_refund_settlement_items(refund_id, order_item_id, product_id, quantity, refund_amount, cogs)
    VALUES (v_refund_id, v_item.id, v_item.product_id, v_item.quantity, v_item_refund,
      ROUND((v_item.cost_price * v_item.quantity) * 100) / 100);

    IF v_order.inventory_deducted AND v_item.product_id IS NOT NULL THEN
      UPDATE products
      SET stock_quantity = stock_quantity + v_item.quantity,
          updated_at = NOW()
      WHERE id = v_item.product_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_REFUND_PRODUCT_NOT_FOUND: Product % no longer exists', v_item.product_id;
      END IF;
      INSERT INTO inventory_movements(
        product_id, product_name, sku, type, quantity, previous_quantity,
        resulting_quantity, reason, reference_type, reference_id, performed_by
      )
      SELECT p.id, p.name, p.sku, 'return', v_item.quantity,
             p.stock_quantity - v_item.quantity, p.stock_quantity,
             v_reason, 'return', v_refund_id::TEXT, COALESCE(v_cashier_id::TEXT, 'POS Refund')
      FROM products p WHERE p.id = v_item.product_id;

      IF v_item.serial_number IS NOT NULL THEN
        UPDATE serialized_devices
        SET status = 'returned', updated_at = NOW()
        WHERE serial_number = TRIM(v_item.serial_number) AND order_id = v_order_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'ERR_REFUND_SERIAL_NOT_FOUND: Serialized device is not linked to this order';
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF v_cash_amount > 0 THEN
    INSERT INTO cash_drawer_movements(
      shift_id, branch_id, cashier_id, type, amount, reason, reference_type, reference_id
    ) VALUES (
      v_shift_id, v_branch_id, v_cashier_id, 'refund_cash', v_cash_amount,
      v_reason, 'order', v_order_id
    ) RETURNING id INTO v_cash_movement_id;

    UPDATE cash_drawer_shifts
    SET expected_cash = ROUND((expected_cash - v_cash_amount) * 100) / 100,
        updated_at = NOW()
    WHERE id = v_shift_id;
  END IF;

  INSERT INTO financial_transactions(
    transaction_ref, channel, type, amount, cogs, net_profit, reference_id,
    description, date, branch_id, shift_id, cashier_id, payment_method,
    cash_amount, card_amount, wallet_amount, reversal_of, idempotency_key, created_at
  ) VALUES (
    'REFUND-PARTIAL-' || v_refund_id::TEXT, 'pos', 'refund', v_refund_amount,
    v_cogs, -v_refund_amount + v_cogs, v_order_id::TEXT,
    'Partial refund for Order #' || v_order.order_number,
    CURRENT_DATE, v_branch_id, v_shift_id, v_cashier_id,
    CASE
      WHEN v_cash_amount > 0 AND v_card_amount > 0 THEN 'mixed'
      WHEN v_cash_amount > 0 THEN 'pos_cash'
      WHEN v_card_amount > 0 THEN 'card'
      ELSE 'wallet'
    END,
    v_cash_amount, v_card_amount, v_wallet_amount, v_sale.id, v_idempotency_key, NOW()
  ) RETURNING id INTO v_ledger_id;

  IF ROUND((v_prior_refunded + v_refund_amount) * 100) >= ROUND(v_paid_total * 100) THEN
    UPDATE payments SET status = 'refunded' WHERE order_id = v_order_id AND status = 'paid';
    UPDATE orders SET payment_status = 'refunded', status = 'returned', inventory_deducted = false, updated_at = NOW()
    WHERE id = v_order_id;
  END IF;

  INSERT INTO audit_logs(
    user_id, user_name, user_role, action, entity, entity_id,
    previous_value, new_value, details
  ) VALUES (
    v_cashier_id::TEXT, COALESCE(NULLIF(TRIM(v_order.cashier_name), ''), 'POS Cashier'),
    COALESCE(v_role, 'cashier'), 'PARTIAL_REFUND', 'Order', v_order_id::TEXT,
    'payment_status=' || v_order.payment_status || ';status=' || v_order.status,
    'partial_refund=' || v_refund_amount::TEXT,
    jsonb_build_object(
      'refund_id', v_refund_id, 'refund_amount', v_refund_amount,
      'cash_refund_amount', v_cash_amount, 'card_refund_amount', v_card_amount,
      'wallet_refund_amount', v_wallet_amount, 'shift_id', v_shift_id,
      'reason', v_reason, 'approval_id', v_approval_id,
      'idempotency_key', v_idempotency_key, 'cogs', v_cogs
    )::TEXT
  );

  RETURN jsonb_build_object(
    'success', true, 'existing', false, 'partial', true,
    'refund_id', v_refund_id, 'order_id', v_order_id,
    'refund_amount', v_refund_amount, 'cash_refund_amount', v_cash_amount,
    'card_refund_amount', v_card_amount, 'wallet_refund_amount', v_wallet_amount,
    'shift_id', v_shift_id, 'cash_movement_id', v_cash_movement_id,
    'ledger_id', v_ledger_id, 'idempotency_key', v_idempotency_key,
    'remaining_refundable', ROUND((v_paid_total - v_prior_refunded - v_refund_amount) * 100) / 100
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_pos_partial_refund(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_partial_refund(JSONB) TO service_role;

COMMENT ON FUNCTION fn_atomic_pos_partial_refund(JSONB) IS
'Atomic item-level POS partial refund with quantity limits, mixed-tender allocation, inventory restoration, cash settlement, ledger reversal, approval and durable idempotency.';
