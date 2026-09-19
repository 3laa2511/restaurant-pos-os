-- ==============================================================================
-- BO'SH STORE — PARTIAL REFUND VALIDATION CORRECTION
-- Migration: 20260909_040_partial_refund_validation_fix
-- Purpose: replace the initial partial-refund function with explicit requested
--          quantity variables and deterministic validation before any mutation.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_atomic_pos_partial_refund(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID := NULLIF(p_payload->>'order_id', '')::UUID;
  v_branch_id UUID := NULLIF(p_payload->>'branch_id', '')::UUID;
  v_cashier_id UUID := NULLIF(p_payload->>'cashier_id', '')::UUID;
  v_shift_id UUID := NULLIF(p_payload->>'shift_id', '')::UUID;
  v_approval_id UUID := NULLIF(p_payload->>'approval_id', '')::UUID;
  v_idempotency_key TEXT := NULLIF(TRIM(p_payload->>'idempotency_key'), '');
  v_reason TEXT := COALESCE(NULLIF(TRIM(p_payload->>'reason'), ''), 'POS partial refund');
  v_order orders%ROWTYPE;
  v_shift cash_drawer_shifts%ROWTYPE;
  v_sale financial_transactions%ROWTYPE;
  v_row RECORD;
  v_requested RECORD;
  v_existing pos_refund_settlements%ROWTYPE;
  v_refund_id UUID;
  v_cash_movement_id UUID;
  v_ledger_id UUID;
  v_refund_amount NUMERIC(12,2) := 0;
  v_cogs NUMERIC(12,2) := 0;
  v_paid_total NUMERIC(12,2) := 0;
  v_prior_refunded NUMERIC(12,2) := 0;
  v_remaining NUMERIC(12,2) := 0;
  v_cash_amount NUMERIC(12,2) := 0;
  v_card_amount NUMERIC(12,2) := 0;
  v_wallet_amount NUMERIC(12,2) := 0;
  v_residual NUMERIC(12,2) := 0;
  v_discount_factor NUMERIC(18,10) := 1;
  v_item_refund NUMERIC(12,2);
  v_prior_qty INT;
  v_sold_qty INT;
  v_requested_qty INT;
  v_item_count INT;
  v_distinct_count INT;
  v_is_manager BOOLEAN := false;
  v_role TEXT;
  v_high_threshold NUMERIC(12,4);
  v_critical_threshold NUMERIC(12,4);
BEGIN
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

  SELECT * INTO v_existing
  FROM pos_refund_settlements
  WHERE idempotency_key = v_idempotency_key
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.order_id <> v_order_id OR v_existing.branch_id <> v_branch_id OR v_existing.cashier_id <> v_cashier_id THEN
      RAISE EXCEPTION 'ERR_REFUND_IDEMPOTENCY_REUSE: Idempotency-Key is bound to a different refund context';
    END IF;
    RETURN jsonb_build_object(
      'success', true, 'existing', true, 'partial', true, 'refund_id', v_existing.id,
      'order_id', v_existing.order_id, 'refund_amount', v_existing.amount,
      'cash_refund_amount', v_existing.cash_amount, 'card_refund_amount', v_existing.card_amount,
      'wallet_refund_amount', v_existing.wallet_amount, 'shift_id', v_existing.shift_id,
      'idempotency_key', v_existing.idempotency_key
    );
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
  INTO v_item_count, v_distinct_count
  FROM jsonb_to_recordset(p_payload->'refund_items') AS x(order_item_id UUID, quantity INT);
  IF v_item_count <> v_distinct_count THEN
    RAISE EXCEPTION 'ERR_DUPLICATE_REFUND_ITEM: The same order item cannot appear more than once';
  END IF;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2)
  INTO v_paid_total
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
  IF NOT FOUND OR ROUND(v_sale.amount * 100) <> ROUND(v_paid_total * 100) THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_PAYMENT_MISMATCH: Settled payment total does not match the authoritative sale ledger';
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

  -- First pass: lock every requested order item and validate quantity against
  -- original quantity minus quantities already refunded in prior settlements.
  FOR v_requested IN
    SELECT * FROM jsonb_to_recordset(p_payload->'refund_items') AS x(order_item_id UUID, quantity INT)
  LOOP
    v_requested_qty := v_requested.quantity;
    IF v_requested.order_item_id IS NULL OR v_requested_qty IS NULL OR v_requested_qty <= 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_REFUND_ITEM: Refund item requires a positive quantity and order_item_id';
    END IF;

    SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price, oi.total, oi.cost_price, oi.serial_number
    INTO v_row
    FROM order_items oi
    WHERE oi.id = v_requested.order_item_id AND oi.order_id = v_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_REFUND_ITEM_NOT_FOUND: Refund item does not belong to this order';
    END IF;

    v_sold_qty := v_row.quantity;
    SELECT COALESCE(SUM(prsi.quantity), 0)::INT INTO v_prior_qty
    FROM pos_refund_settlement_items prsi
    JOIN pos_refund_settlements prs ON prs.id = prsi.refund_id
    WHERE prsi.order_item_id = v_row.id AND prs.status = 'completed';

    IF v_requested_qty > GREATEST(0, v_sold_qty - v_prior_qty) THEN
      RAISE EXCEPTION 'ERR_REFUND_QUANTITY_EXCEEDED: Requested quantity % exceeds remaining refundable quantity % for item %',
        v_requested_qty, GREATEST(0, v_sold_qty - v_prior_qty), v_row.id;
    END IF;
    IF v_row.serial_number IS NOT NULL AND v_requested_qty <> 1 THEN
      RAISE EXCEPTION 'ERR_SERIAL_REFUND_QUANTITY_INVALID: Serialized items can only be refunded one unit at a time';
    END IF;

    v_item_refund := ROUND((v_row.unit_price * v_requested_qty * v_discount_factor) * 100) / 100;
    IF v_item_refund <= 0 THEN
      RAISE EXCEPTION 'ERR_INVALID_REFUND_AMOUNT: Calculated item refund must be greater than zero';
    END IF;
    v_refund_amount := ROUND((v_refund_amount + v_item_refund) * 100) / 100;
    v_cogs := ROUND((v_cogs + v_row.cost_price * v_requested_qty) * 100) / 100;
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
  IF v_refund_amount >= v_critical_threshold AND NOT v_is_manager AND v_approval_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_CRITICAL_APPROVAL_REQUIRED: Critical POS partial refunds require manager approval';
  END IF;
  IF v_approval_id IS NOT NULL THEN
    PERFORM fn_consume_approval_request(
      v_approval_id, v_cashier_id::VARCHAR, v_branch_id, v_shift_id,
      'REFUND_ORDER', v_refund_amount, v_order_id
    );
  END IF;

  -- Mixed-tender allocation is proportional to the original sale ledger. The
  -- largest original tender receives the deterministic final-cent residual.
  v_cash_amount := ROUND(v_sale.cash_amount * (v_refund_amount / v_sale.amount) * 100) / 100;
  v_card_amount := ROUND(v_sale.card_amount * (v_refund_amount / v_sale.amount) * 100) / 100;
  v_wallet_amount := ROUND(v_sale.wallet_amount * (v_refund_amount / v_sale.amount) * 100) / 100;
  v_residual := ROUND((v_refund_amount - v_cash_amount - v_card_amount - v_wallet_amount) * 100) / 100;
  IF v_residual <> 0 THEN
    IF v_sale.cash_amount >= v_sale.card_amount AND v_sale.cash_amount >= v_sale.wallet_amount THEN
      v_cash_amount := v_cash_amount + v_residual;
    ELSIF v_sale.card_amount >= v_sale.wallet_amount THEN
      v_card_amount := v_card_amount + v_residual;
    ELSE
      v_wallet_amount := v_wallet_amount + v_residual;
    END IF;
  END IF;
  IF v_cash_amount < 0 OR v_card_amount < 0 OR v_wallet_amount < 0
     OR ROUND((v_cash_amount + v_card_amount + v_wallet_amount) * 100) <> ROUND(v_refund_amount * 100) THEN
    RAISE EXCEPTION 'ERR_REFUND_TENDER_ALLOCATION_INVALID: Refund tender allocation does not equal refund amount';
  END IF;
  IF v_cash_amount > v_shift.expected_cash THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_DRAWER_CASH: Drawer does not contain enough expected cash for this refund';
  END IF;

  INSERT INTO pos_refund_settlements(
    order_id, branch_id, shift_id, cashier_id, amount, cash_amount, card_amount,
    wallet_amount, reason, idempotency_key, approval_id
  ) VALUES (
    v_order_id, v_branch_id, v_shift_id, v_cashier_id, v_refund_amount,
    v_cash_amount, v_card_amount, v_wallet_amount, v_reason, v_idempotency_key, v_approval_id
  ) RETURNING id INTO v_refund_id;

  -- Second pass performs inventory and settlement mutations using the already
  -- validated quantities from the request. All statements remain one transaction.
  FOR v_requested IN
    SELECT * FROM jsonb_to_recordset(p_payload->'refund_items') AS x(order_item_id UUID, quantity INT)
  LOOP
    v_requested_qty := v_requested.quantity;
    SELECT oi.* INTO v_row FROM order_items oi
    WHERE oi.id = v_requested.order_item_id AND oi.order_id = v_order_id
    FOR UPDATE;

    v_item_refund := ROUND((v_row.unit_price * v_requested_qty * v_discount_factor) * 100) / 100;
    INSERT INTO pos_refund_settlement_items(
      refund_id, order_item_id, product_id, quantity, refund_amount, cogs
    ) VALUES (
      v_refund_id, v_row.id, v_row.product_id, v_requested_qty, v_item_refund,
      ROUND((v_row.cost_price * v_requested_qty) * 100) / 100
    );

    IF v_order.inventory_deducted AND v_row.product_id IS NOT NULL THEN
      UPDATE products
      SET stock_quantity = stock_quantity + v_requested_qty, updated_at = NOW()
      WHERE id = v_row.product_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_REFUND_PRODUCT_NOT_FOUND: Product % no longer exists', v_row.product_id;
      END IF;

      INSERT INTO inventory_movements(
        product_id, product_name, sku, type, quantity, previous_quantity,
        resulting_quantity, reason, reference_type, reference_id, performed_by
      )
      SELECT p.id, p.name, p.sku, 'return', v_requested_qty,
             p.stock_quantity - v_requested_qty, p.stock_quantity,
             v_reason, 'return', v_refund_id::TEXT, v_cashier_id::TEXT
      FROM products p WHERE p.id = v_row.product_id;

      IF v_row.serial_number IS NOT NULL THEN
        UPDATE serialized_devices
        SET status = 'returned', updated_at = NOW()
        WHERE serial_number = TRIM(v_row.serial_number) AND order_id = v_order_id;
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
    SET expected_cash = ROUND((expected_cash - v_cash_amount) * 100) / 100, updated_at = NOW()
    WHERE id = v_shift_id;
  END IF;

  INSERT INTO financial_transactions(
    transaction_ref, channel, type, amount, cogs, net_profit, reference_id,
    description, date, branch_id, shift_id, cashier_id, payment_method,
    cash_amount, card_amount, wallet_amount, reversal_of, idempotency_key, created_at
  ) VALUES (
    'REFUND-PARTIAL-' || v_refund_id::TEXT, 'pos', 'refund', v_refund_amount,
    v_cogs, -v_refund_amount + v_cogs, v_order_id::TEXT,
    'Partial refund for Order #' || v_order.order_number, CURRENT_DATE,
    v_branch_id, v_shift_id, v_cashier_id,
    CASE
      WHEN v_cash_amount > 0 AND (v_card_amount > 0 OR v_wallet_amount > 0) THEN 'mixed'
      WHEN v_card_amount > 0 AND v_wallet_amount > 0 THEN 'mixed'
      WHEN v_cash_amount > 0 THEN 'pos_cash'
      WHEN v_card_amount > 0 THEN 'card'
      ELSE 'wallet'
    END,
    v_cash_amount, v_card_amount, v_wallet_amount, v_sale.id, v_idempotency_key, NOW()
  ) RETURNING id INTO v_ledger_id;

  IF ROUND((v_prior_refunded + v_refund_amount) * 100) >= ROUND(v_paid_total * 100) THEN
    UPDATE payments SET status = 'refunded' WHERE order_id = v_order_id AND status = 'paid';
    UPDATE orders
    SET payment_status = 'refunded', status = 'returned', inventory_deducted = false, updated_at = NOW()
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
    'success', true, 'existing', false, 'partial', true, 'refund_id', v_refund_id,
    'order_id', v_order_id, 'refund_amount', v_refund_amount,
    'cash_refund_amount', v_cash_amount, 'card_refund_amount', v_card_amount,
    'wallet_refund_amount', v_wallet_amount, 'shift_id', v_shift_id,
    'cash_movement_id', v_cash_movement_id, 'ledger_id', v_ledger_id,
    'idempotency_key', v_idempotency_key,
    'remaining_refundable', ROUND((v_paid_total - v_prior_refunded - v_refund_amount) * 100) / 100
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_pos_partial_refund(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_partial_refund(JSONB) TO service_role;
