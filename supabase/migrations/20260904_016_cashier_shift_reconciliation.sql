-- ==============================================================================
-- BO'SH STORE — CASHIER SHIFT RECONCILIATION, REFUND LEDGER & X/Z REPORTS
-- Migration: 20260904_016_cashier_shift_reconciliation
-- Purpose: server-authoritative cashier session lifecycle, durable refund ledger,
--          interim X-report audit, and closing Z-report shift reconciliation.
-- ==============================================================================

-- 1. DURABLE REFUND LEDGER TABLE
CREATE TABLE IF NOT EXISTS payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  shift_id UUID NOT NULL REFERENCES cash_drawer_shifts(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL,
  cashier_id UUID NOT NULL,
  cashier_name VARCHAR(255) NOT NULL,
  refund_amount NUMERIC(12,2) NOT NULL CHECK (refund_amount > 0),
  cash_refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cash_refund_amount >= 0),
  non_cash_refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (non_cash_refund_amount >= 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_shift ON payment_refunds(shift_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_order ON payment_refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_branch ON payment_refunds(branch_id, created_at DESC);

ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE payment_refunds FROM anon, authenticated;
GRANT ALL ON TABLE payment_refunds TO service_role;

-- 2. HARDEN ATOMIC POS CHECKOUT TO MAINTAIN EXPECTED DRAWER CASH IN REAL TIME
CREATE OR REPLACE FUNCTION fn_atomic_pos_checkout(p_order_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id UUID;
  v_branch_id UUID;
  v_cashier_id UUID;
  v_order_result JSONB;
  v_order_id UUID;
  v_existing_source TEXT;
  v_payment_shift_id UUID;
  v_cash_paid NUMERIC(12,2);
BEGIN
  IF COALESCE(NULLIF(p_order_payload->>'source', ''), '') NOT IN ('pos_cashier', 'pos_store') THEN
    RAISE EXCEPTION 'ERR_POS_SOURCE_REQUIRED: POS checkout source is required';
  END IF;

  BEGIN
    v_branch_id := NULLIF(p_order_payload->>'branch_id', '')::UUID;
    v_cashier_id := NULLIF(p_order_payload->>'cashier_id', '')::UUID;
    v_shift_id := NULLIF(p_order_payload->>'shift_id', '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_SHIFT_CONTEXT: branch, cashier and shift IDs must be valid UUIDs';
  END;

  IF v_branch_id IS NULL OR v_cashier_id IS NULL OR v_shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_SHIFT_REQUIRED: An open cash drawer shift is required for POS checkout';
  END IF;

  -- Idempotent retry: if this exact order already settled against a shift,
  -- return it without requiring the cashier to reopen the old shift.
  SELECT o.id, o.source, p.shift_id
    INTO v_order_id, v_existing_source, v_payment_shift_id
  FROM orders o
  LEFT JOIN payments p ON p.order_id = o.id
  WHERE o.order_number = NULLIF(TRIM(p_order_payload->>'order_number'), '')
  ORDER BY p.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    IF v_existing_source NOT IN ('pos_cashier', 'pos_store') THEN
      RAISE EXCEPTION 'ERR_ORDER_NUMBER_CONFLICT: Order number already belongs to a non-POS order';
    END IF;
    IF v_payment_shift_id IS NULL THEN
      RAISE EXCEPTION 'ERR_SHIFT_BINDING_MISSING: Existing POS payment is missing its cash drawer shift binding';
    END IF;
    RETURN fn_atomic_checkout(p_order_payload);
  END IF;

  -- Lock the shift before checkout. Closing the shift uses the same row lock,
  -- so a close cannot race a sale and miss its payment.
  PERFORM 1
  FROM cash_drawer_shifts
  WHERE id = v_shift_id
    AND branch_id = v_branch_id
    AND cashier_id = v_cashier_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_REQUIRED: No open cash drawer shift belongs to this cashier and branch';
  END IF;

  v_order_result := fn_atomic_checkout(p_order_payload);
  v_order_id := NULLIF(v_order_result->>'order_id', '')::UUID;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'ERR_ATOMIC_CHECKOUT_FAILED: Atomic checkout did not return an order ID';
  END IF;

  -- The inner function created the authoritative payment. Bind that exact
  -- payment to the locked shift before the transaction is allowed to commit.
  UPDATE payments
  SET shift_id = v_shift_id
  WHERE order_id = v_order_id
    AND shift_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_PAYMENT_BINDING_FAILED: POS payment could not be bound to the cash drawer shift';
  END IF;

  -- Maintain expected_cash in real time for any cash portion of this sale
  SELECT COALESCE(cash_amount, 0) INTO v_cash_paid
  FROM payments
  WHERE order_id = v_order_id
  LIMIT 1;

  IF v_cash_paid > 0 THEN
    UPDATE cash_drawer_shifts
    SET expected_cash = ROUND(expected_cash + v_cash_paid, 2),
        updated_at = NOW()
    WHERE id = v_shift_id;
  END IF;

  RETURN v_order_result || jsonb_build_object('shift_id', v_shift_id);
END;
$$;

-- 3. HARDEN ATOMIC POS REFUND WITH DURABLE REFUND LEDGER
CREATE OR REPLACE FUNCTION fn_atomic_pos_refund(
  p_order_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID,
  p_shift_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders;
  v_payment payments;
  v_shift cash_drawer_shifts;
  v_item RECORD;
  v_product products;
  v_refund NUMERIC(12,2);
  v_cash_refund NUMERIC(12,2);
  v_non_cash_refund NUMERIC(12,2);
  v_reason TEXT;
  v_movement_id UUID;
  v_refund_ledger_id UUID;
  v_refund_items INT := 0;
  v_cashier_name TEXT;
  v_cashier_role TEXT;
BEGIN
  IF p_order_id IS NULL OR p_branch_id IS NULL OR p_cashier_id IS NULL OR p_shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_CONTEXT_REQUIRED: Order, branch, cashier and shift are required';
  END IF;

  v_reason := COALESCE(NULLIF(TRIM(p_reason), ''), 'POS order refund');

  -- Lock the active drawer. Refunds are accountable to the cashier performing
  -- them, even when the original sale belongs to an earlier shift.
  SELECT * INTO v_shift
  FROM cash_drawer_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND cashier_id = p_cashier_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_REQUIRED: An open cash drawer shift is required for POS refund';
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
    AND branch_id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REFUND_ORDER_NOT_FOUND: POS order was not found in this branch';
  END IF;

  IF v_order.source NOT IN ('pos_cashier', 'pos_store') THEN
    RAISE EXCEPTION 'ERR_POS_REFUND_REQUIRED: Only POS orders can use the POS refund settlement path';
  END IF;

  IF v_order.status = 'returned' OR v_order.payment_status = 'refunded' THEN
    RAISE EXCEPTION 'ERR_ALREADY_REFUNDED: This order has already been refunded';
  END IF;

  SELECT * INTO v_payment
  FROM payments
  WHERE order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REFUND_PAYMENT_NOT_FOUND: A payment record is required before refunding';
  END IF;

  IF v_payment.status = 'refunded' THEN
    RAISE EXCEPTION 'ERR_ALREADY_REFUNDED: This payment has already been refunded';
  END IF;

  IF v_payment.status <> 'paid' THEN
    RAISE EXCEPTION 'ERR_REFUND_PAYMENT_NOT_SETTLED: Only a paid POS payment can be refunded';
  END IF;

  IF v_payment.shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_SHIFT_BINDING_MISSING: POS payment is missing its cash drawer shift binding';
  END IF;

  v_refund := ROUND(COALESCE(v_payment.paid_amount, v_payment.amount, 0), 2);
  v_cash_refund := ROUND(COALESCE(v_payment.cash_amount, 0), 2);
  v_non_cash_refund := ROUND(v_refund - v_cash_refund, 2);

  IF v_refund <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_REFUND_AMOUNT: Authoritative payment amount must be greater than zero';
  END IF;

  IF v_cash_refund > v_shift.expected_cash THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_DRAWER_CASH: Drawer does not contain enough expected cash for this refund';
  END IF;

  -- Cashier identity lookup for ledger and audit
  SELECT COALESCE(NULLIF(TRIM(p.name), ''), 'POS Cashier'), COALESCE(p.role::TEXT, 'cashier')
    INTO v_cashier_name, v_cashier_role
  FROM profiles p
  WHERE p.user_id = p_cashier_id OR p.id = p_cashier_id
  ORDER BY CASE WHEN p.user_id = p_cashier_id THEN 0 ELSE 1 END
  LIMIT 1;

  -- Restore inventory and serialized-device state atomically with financial settlement
  IF v_order.inventory_deducted THEN
    FOR v_item IN
      SELECT product_id, product_name, sku, quantity, serial_number, total
      FROM order_items
      WHERE order_id = p_order_id
        AND product_id IS NOT NULL
      ORDER BY id
    LOOP
      SELECT * INTO v_product
      FROM products
      WHERE id = v_item.product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_REFUND_PRODUCT_NOT_FOUND: Product % no longer exists', v_item.product_id;
      END IF;

      INSERT INTO inventory_movements(
        product_id, product_name, sku, type, quantity,
        previous_quantity, resulting_quantity, reason,
        reference_type, reference_id, performed_by
      ) VALUES (
        v_product.id,
        v_product.name,
        v_product.sku,
        'return',
        v_item.quantity,
        v_product.stock_quantity,
        v_product.stock_quantity + v_item.quantity,
        v_reason,
        'return',
        p_order_id::TEXT,
        COALESCE(NULLIF(TRIM(v_order.cashier_name), ''), v_cashier_name, 'POS Refund')
      );

      UPDATE products
      SET stock_quantity = stock_quantity + v_item.quantity,
          updated_at = NOW()
      WHERE id = v_product.id;

      IF NULLIF(TRIM(COALESCE(v_item.serial_number, '')), '') IS NOT NULL THEN
        UPDATE serialized_devices
        SET status = 'returned',
            updated_at = NOW()
        WHERE serial_number = TRIM(v_item.serial_number)
          AND order_id = p_order_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'ERR_REFUND_SERIAL_NOT_FOUND: Serialized device % is not linked to this order', v_item.serial_number;
        END IF;
      END IF;

      v_refund_items := v_refund_items + 1;
    END LOOP;

    UPDATE orders
    SET inventory_deducted = false,
        updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  -- 1. Record in durable refund ledger
  INSERT INTO payment_refunds (
    order_id, payment_id, shift_id, branch_id,
    cashier_id, cashier_name, refund_amount,
    cash_refund_amount, non_cash_refund_amount, reason
  ) VALUES (
    p_order_id, v_payment.id, p_shift_id, p_branch_id,
    p_cashier_id, COALESCE(v_cashier_name, 'POS Cashier'),
    v_refund, v_cash_refund, v_non_cash_refund, v_reason
  ) RETURNING id INTO v_refund_ledger_id;

  -- 2. If cash was returned, record drawer movement and update expected cash
  IF v_cash_refund > 0 THEN
    INSERT INTO cash_drawer_movements(
      shift_id, branch_id, cashier_id, type, amount,
      reason, reference_type, reference_id
    ) VALUES (
      p_shift_id, p_branch_id, p_cashier_id, 'refund_cash',
      v_cash_refund, v_reason, 'order', p_order_id
    )
    RETURNING id INTO v_movement_id;

    UPDATE cash_drawer_shifts
    SET expected_cash = ROUND(expected_cash - v_cash_refund, 2),
        updated_at = NOW()
    WHERE id = p_shift_id;
  END IF;

  -- 3. Update payment and order statuses
  UPDATE payments
  SET status = 'refunded'
  WHERE id = v_payment.id;

  UPDATE orders
  SET payment_status = 'refunded',
      status = 'returned',
      updated_at = NOW()
  WHERE id = p_order_id;

  -- 4. Audit trail
  INSERT INTO audit_logs(
    user_id, user_name, user_role, action, entity, entity_id,
    previous_value, new_value, details
  ) VALUES (
    p_cashier_id::TEXT,
    COALESCE(v_cashier_name, 'POS Cashier'),
    COALESCE(v_cashier_role, 'cashier'),
    'REFUND_ORDER',
    'Order',
    p_order_id::TEXT,
    'payment_status=paid;status=' || v_order.status,
    'payment_status=refunded;status=returned',
    jsonb_build_object(
      'refund_ledger_id', v_refund_ledger_id,
      'refund_amount', v_refund,
      'cash_refund_amount', v_cash_refund,
      'non_cash_refund_amount', v_non_cash_refund,
      'shift_id', p_shift_id,
      'reason', v_reason,
      'inventory_items_restored', v_refund_items
    )::TEXT
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'refund_ledger_id', v_refund_ledger_id,
    'refund_amount', v_refund,
    'cash_refund_amount', v_cash_refund,
    'non_cash_refund_amount', v_non_cash_refund,
    'shift_id', p_shift_id,
    'cash_movement_id', v_movement_id,
    'payment_id', v_payment.id,
    'inventory_items_restored', v_refund_items
  );
END;
$$;

-- 4. RECONCILIATION SUMMARY FUNCTION
CREATE OR REPLACE FUNCTION fn_get_cashier_shift_summary(
  p_shift_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift cash_drawer_shifts;
  v_branch branches;
  v_cash_sales NUMERIC(12,2) := 0;
  v_card_sales NUMERIC(12,2) := 0;
  v_wallet_sales NUMERIC(12,2) := 0;
  v_gross_sales NUMERIC(12,2) := 0;
  v_discount_total NUMERIC(12,2) := 0;
  v_sales_count INT := 0;
  v_cash_sales_count INT := 0;
  v_card_sales_count INT := 0;
  v_wallet_sales_count INT := 0;
  v_mixed_sales_count INT := 0;
  v_cash_in NUMERIC(12,2) := 0;
  v_cash_out NUMERIC(12,2) := 0;
  v_cash_in_count INT := 0;
  v_cash_out_count INT := 0;
  v_total_refunds NUMERIC(12,2) := 0;
  v_cash_refunds NUMERIC(12,2) := 0;
  v_non_cash_refunds NUMERIC(12,2) := 0;
  v_refunds_count INT := 0;
  v_expected_cash NUMERIC(12,2) := 0;
  v_net_sales NUMERIC(12,2) := 0;
  v_movements_json JSONB;
BEGIN
  IF p_shift_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_SHIFT_PARAM_REQUIRED: shift_id and branch_id are required';
  END IF;

  SELECT * INTO v_shift
  FROM cash_drawer_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: Shift not found in this branch';
  END IF;

  IF p_cashier_id IS NOT NULL AND v_shift.cashier_id <> p_cashier_id THEN
    RAISE EXCEPTION 'ERR_SHIFT_ACCESS_DENIED: Shift does not belong to this cashier';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;

  -- 1. Sales totals bound to this shift
  SELECT
    COALESCE(SUM(p.cash_amount), 0),
    COALESCE(SUM(p.card_amount), 0),
    COALESCE(SUM(p.wallet_amount), 0),
    COALESCE(SUM(COALESCE(p.paid_amount, p.amount, 0)), 0),
    COUNT(p.id),
    COUNT(CASE WHEN p.payment_method = 'pos_cash' OR (p.payment_method = 'cash' AND p.cash_amount > 0) THEN 1 END),
    COUNT(CASE WHEN p.payment_method = 'card' THEN 1 END),
    COUNT(CASE WHEN p.payment_method IN ('wallet', 'instapay') THEN 1 END),
    COUNT(CASE WHEN p.payment_method = 'mixed' THEN 1 END)
  INTO
    v_cash_sales,
    v_card_sales,
    v_wallet_sales,
    v_gross_sales,
    v_sales_count,
    v_cash_sales_count,
    v_card_sales_count,
    v_wallet_sales_count,
    v_mixed_sales_count
  FROM payments p
  WHERE p.shift_id = v_shift.id;

  -- 2. Discounts total for orders in this shift
  SELECT COALESCE(SUM(o.discount), 0)
  INTO v_discount_total
  FROM orders o
  JOIN payments p ON p.order_id = o.id
  WHERE p.shift_id = v_shift.id;

  -- 3. Drawer manual cash in / out movements
  SELECT
    COALESCE(SUM(CASE WHEN m.type = 'cash_in' THEN m.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN m.type = 'cash_out' THEN m.amount ELSE 0 END), 0),
    COUNT(CASE WHEN m.type = 'cash_in' THEN 1 END),
    COUNT(CASE WHEN m.type = 'cash_out' THEN 1 END)
  INTO
    v_cash_in,
    v_cash_out,
    v_cash_in_count,
    v_cash_out_count
  FROM cash_drawer_movements m
  WHERE m.shift_id = v_shift.id;

  -- 4. Refunds settled against this shift
  SELECT
    COALESCE(SUM(pr.refund_amount), 0),
    COALESCE(SUM(pr.cash_refund_amount), 0),
    COALESCE(SUM(pr.non_cash_refund_amount), 0),
    COUNT(pr.id)
  INTO
    v_total_refunds,
    v_cash_refunds,
    v_non_cash_refunds,
    v_refunds_count
  FROM payment_refunds pr
  WHERE pr.shift_id = v_shift.id;

  -- If no payment_refunds records exist yet (legacy), fallback to cash_drawer_movements
  IF v_cash_refunds = 0 THEN
    SELECT COALESCE(SUM(m.amount), 0)
    INTO v_cash_refunds
    FROM cash_drawer_movements m
    WHERE m.shift_id = v_shift.id AND m.type = 'refund_cash';
    IF v_total_refunds = 0 THEN
      v_total_refunds := v_cash_refunds;
    END IF;
  END IF;

  -- 5. Authoritative Expected Cash formula
  v_expected_cash := ROUND(v_shift.opening_float + v_cash_sales + v_cash_in - v_cash_out - v_cash_refunds, 2);
  v_net_sales := ROUND(v_gross_sales - v_total_refunds, 2);

  -- 6. Collect movement audit list
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'type', m.type,
      'amount', m.amount,
      'reason', m.reason,
      'created_at', m.created_at
    ) ORDER BY m.created_at ASC
  ), '[]'::jsonb)
  INTO v_movements_json
  FROM cash_drawer_movements m
  WHERE m.shift_id = v_shift.id;

  RETURN jsonb_build_object(
    'shift_id', v_shift.id,
    'branch_id', v_shift.branch_id,
    'branch_name', COALESCE(v_branch.name, 'Main Branch'),
    'branch_code', COALESCE(v_branch.code, 'MAIN'),
    'cashier_id', v_shift.cashier_id,
    'cashier_name', v_shift.cashier_name,
    'status', v_shift.status,
    'opened_at', v_shift.opened_at,
    'closed_at', v_shift.closed_at,
    'opening_float', v_shift.opening_float,
    'cash_sales_amount', v_cash_sales,
    'card_sales_amount', v_card_sales,
    'wallet_sales_amount', v_wallet_sales,
    'gross_sales_amount', v_gross_sales,
    'discount_total', v_discount_total,
    'net_sales_amount', v_net_sales,
    'cash_in_amount', v_cash_in,
    'cash_out_amount', v_cash_out,
    'cash_refund_amount', v_cash_refunds,
    'non_cash_refund_amount', v_non_cash_refunds,
    'total_refund_amount', v_total_refunds,
    'expected_cash', v_expected_cash,
    'actual_cash', v_shift.actual_cash,
    'variance', v_shift.variance,
    'sales_count', v_sales_count,
    'cash_sales_count', v_cash_sales_count,
    'card_sales_count', v_card_sales_count,
    'wallet_sales_count', v_wallet_sales_count,
    'mixed_sales_count', v_mixed_sales_count,
    'cash_in_count', v_cash_in_count,
    'cash_out_count', v_cash_out_count,
    'refunds_count', v_refunds_count,
    'closing_note', v_shift.closing_note,
    'movements', v_movements_json
  );
END;
$$;

-- 5. X-REPORT (INTERIM AUDIT) RPC
CREATE OR REPLACE FUNCTION fn_get_cashier_x_report(
  p_shift_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary JSONB;
BEGIN
  v_summary := fn_get_cashier_shift_summary(p_shift_id, p_branch_id, p_cashier_id);
  RETURN v_summary || jsonb_build_object(
    'report_type', 'X',
    'report_title', 'X-REPORT (Interim Shift Audit / تقرير وردية مؤقت)',
    'generated_at', NOW(),
    'is_interim', true
  );
END;
$$;

-- 6. CLOSE SHIFT & RECONCILE (CREATES Z-REPORT)
CREATE OR REPLACE FUNCTION fn_close_cash_drawer_shift(
  p_shift_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID,
  p_actual_cash NUMERIC,
  p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift cash_drawer_shifts;
  v_summary JSONB;
  v_expected NUMERIC(12,2);
  v_actual NUMERIC(12,2);
  v_variance NUMERIC(12,2);
  v_z_report JSONB;
BEGIN
  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_ACTUAL_CASH: Actual counted cash must be non-negative';
  END IF;

  -- Lock the shift row to prevent concurrent sales or double-closure
  SELECT * INTO v_shift
  FROM cash_drawer_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND cashier_id = p_cashier_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: Open shift not found for this cashier and branch';
  END IF;

  -- Calculate authoritative summary
  v_summary := fn_get_cashier_shift_summary(p_shift_id, p_branch_id, p_cashier_id);
  v_expected := (v_summary->>'expected_cash')::NUMERIC;
  v_actual := ROUND(p_actual_cash, 2);
  v_variance := ROUND(v_actual - v_expected, 2);

  UPDATE cash_drawer_shifts
  SET status = 'closed',
      closed_at = NOW(),
      expected_cash = v_expected,
      actual_cash = v_actual,
      variance = v_variance,
      closing_note = NULLIF(TRIM(p_note), ''),
      updated_at = NOW()
  WHERE id = v_shift.id;

  -- Audit log for shift closure
  INSERT INTO audit_logs(
    user_id, user_name, user_role, action, entity, entity_id,
    previous_value, new_value, details
  ) VALUES (
    p_cashier_id::TEXT,
    v_shift.cashier_name,
    'cashier',
    'CLOSE_CASH_DRAWER_SHIFT',
    'CashDrawerShift',
    p_shift_id::TEXT,
    'status=open',
    'status=closed',
    jsonb_build_object(
      'shift_id', p_shift_id,
      'opening_float', v_shift.opening_float,
      'expected_cash', v_expected,
      'actual_cash', v_actual,
      'variance', v_variance,
      'closing_note', p_note
    )::TEXT
  );

  -- Build authoritative Z-Report payload
  v_z_report := v_summary || jsonb_build_object(
    'report_type', 'Z',
    'report_title', 'Z-REPORT (Final Shift Settlement / تقرير الإغلاق النهائي)',
    'status', 'closed',
    'closed_at', NOW(),
    'expected_cash', v_expected,
    'actual_cash', v_actual,
    'variance', v_variance,
    'closing_note', NULLIF(TRIM(p_note), ''),
    'generated_at', NOW(),
    'is_interim', false,
    'success', true
  );

  RETURN v_z_report;
END;
$$;

-- 7. Z-REPORT RETRIEVAL RPC
CREATE OR REPLACE FUNCTION fn_get_cashier_z_report(
  p_shift_id UUID,
  p_branch_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift cash_drawer_shifts;
  v_summary JSONB;
BEGIN
  SELECT * INTO v_shift
  FROM cash_drawer_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: Shift not found in this branch';
  END IF;

  IF v_shift.status <> 'closed' THEN
    RAISE EXCEPTION 'ERR_SHIFT_NOT_CLOSED: Z-Report is only available for closed shifts. Use X-Report for active shifts.';
  END IF;

  v_summary := fn_get_cashier_shift_summary(p_shift_id, p_branch_id, NULL);

  RETURN v_summary || jsonb_build_object(
    'report_type', 'Z',
    'report_title', 'Z-REPORT (Final Shift Settlement / تقرير الإغلاق النهائي)',
    'generated_at', NOW(),
    'is_interim', false,
    'success', true
  );
END;
$$;

-- 8. GRANT PRIVILEGES TO service_role AND REVOKE FROM PUBLIC
REVOKE ALL ON FUNCTION fn_atomic_pos_checkout(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_pos_refund(UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_get_cashier_shift_summary(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_get_cashier_x_report(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_close_cash_drawer_shift(UUID,UUID,UUID,NUMERIC,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_get_cashier_z_report(UUID,UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION fn_atomic_pos_checkout(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_refund(UUID,UUID,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_get_cashier_shift_summary(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_get_cashier_x_report(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_close_cash_drawer_shift(UUID,UUID,UUID,NUMERIC,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_get_cashier_z_report(UUID,UUID) TO service_role;
