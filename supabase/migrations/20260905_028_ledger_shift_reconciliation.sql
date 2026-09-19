-- ==============================================================================
-- BO'SH STORE — PHASE 4.9 LEDGER ↔ CASHIER SHIFT RECONCILIATION
-- Migration: 20260905_028_ledger_shift_reconciliation
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_post_order_refund_to_financial_ledger(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_sale financial_transactions%ROWTYPE;
  v_refund_settlement payment_refunds%ROWTYPE;
  v_refunded NUMERIC(12,2);
  v_remaining NUMERIC(12,2);
  v_refund_ref VARCHAR(100);
  v_refund_id UUID;
  v_cogs NUMERIC(12,2);
  v_ratio NUMERIC(18,10) := 1;
  v_cash_amount NUMERIC(12,2) := 0;
  v_card_amount NUMERIC(12,2) := 0;
  v_wallet_amount NUMERIC(12,2) := 0;
  v_tender_residual NUMERIC(12,2) := 0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_FINANCIAL_ORDER_NOT_FOUND: Order % does not exist', p_order_id; END IF;

  SELECT * INTO v_sale FROM financial_transactions
  WHERE type = 'revenue' AND reference_id = p_order_id::text
  ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_FINANCIAL_SALE_NOT_FOUND: No settled sale ledger exists for order %', p_order_id; END IF;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2) INTO v_refunded
  FROM financial_transactions WHERE type = 'refund' AND reference_id = p_order_id::text;
  v_remaining := ROUND((v_sale.amount - v_refunded) * 100) / 100;

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'posted', false, 'existing', true, 'remaining', 0);
  END IF;
  IF v_order.payment_status <> 'refunded' OR v_order.status <> 'returned' THEN
    RETURN jsonb_build_object('success', true, 'posted', false, 'reason', 'ORDER_NOT_FULLY_REFUNDED');
  END IF;

  SELECT * INTO v_refund_settlement FROM payment_refunds
  WHERE order_id = p_order_id ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REFUND_SETTLEMENT_NOT_FOUND: Authoritative POS refund settlement is missing for order %', p_order_id;
  END IF;

  IF v_sale.amount > 0 THEN v_ratio := v_remaining / v_sale.amount; END IF;
  v_cash_amount := ROUND(v_sale.cash_amount * v_ratio * 100) / 100;
  v_card_amount := ROUND(v_sale.card_amount * v_ratio * 100) / 100;
  v_wallet_amount := ROUND(v_sale.wallet_amount * v_ratio * 100) / 100;
  v_tender_residual := ROUND((v_remaining - (v_cash_amount + v_card_amount + v_wallet_amount)) * 100) / 100;

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
     OR ROUND((v_cash_amount + v_card_amount + v_wallet_amount) * 100) <> ROUND(v_remaining * 100) THEN
    RAISE EXCEPTION 'ERR_REFUND_TENDER_ALLOCATION_INVALID: Refund tender allocation does not equal refund amount';
  END IF;

  SELECT COALESCE(SUM(oi.cost_price * oi.quantity), 0)::NUMERIC(12,2)
  INTO v_cogs FROM order_items oi WHERE oi.order_id = p_order_id;
  v_refund_ref := 'REFUND-' || p_order_id::text || '-' || REPLACE(gen_random_uuid()::text, '-', '');

  INSERT INTO financial_transactions (
    transaction_ref, channel, type, amount, cogs, net_profit, reference_id, description, date,
    branch_id, shift_id, cashier_id, payment_method, cash_amount, card_amount, wallet_amount,
    reversal_of, created_at
  ) VALUES (
    v_refund_ref, v_sale.channel, 'refund', v_remaining, v_cogs, -v_remaining + v_cogs,
    p_order_id::text, 'Refund reversal for Order #' || v_order.order_number, CURRENT_DATE,
    v_refund_settlement.branch_id, v_refund_settlement.shift_id, v_refund_settlement.cashier_id,
    v_sale.payment_method, v_cash_amount, v_card_amount, v_wallet_amount, v_sale.id, NOW()
  ) RETURNING id INTO v_refund_id;

  RETURN jsonb_build_object('success', true, 'posted', true, 'transaction_id', v_refund_id,
    'refund_amount', v_remaining, 'cash_amount', v_cash_amount, 'card_amount', v_card_amount,
    'wallet_amount', v_wallet_amount, 'shift_id', v_refund_settlement.shift_id, 'reversed_sale_id', v_sale.id);
END;
$$;

CREATE OR REPLACE FUNCTION fn_calculate_cashier_shift_ledger_reconciliation(
  p_shift_id UUID, p_branch_id UUID, p_cashier_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shift cash_drawer_shifts%ROWTYPE;
  v_cash_sales NUMERIC(12,2) := 0;
  v_cash_refunds NUMERIC(12,2) := 0;
  v_cash_in NUMERIC(12,2) := 0;
  v_cash_out NUMERIC(12,2) := 0;
  v_expected NUMERIC(12,2) := 0;
  v_ledger_sales NUMERIC(12,2) := 0;
  v_ledger_refunds NUMERIC(12,2) := 0;
BEGIN
  SELECT * INTO v_shift FROM cash_drawer_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id
    AND (p_cashier_id IS NULL OR cashier_id = p_cashier_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: Shift does not belong to this branch/cashier'; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN type = 'revenue' THEN cash_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'refund' THEN cash_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'revenue' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END), 0)
  INTO v_cash_sales, v_cash_refunds, v_ledger_sales, v_ledger_refunds
  FROM financial_transactions
  WHERE shift_id = p_shift_id AND branch_id = p_branch_id AND type IN ('revenue', 'refund');

  SELECT
    COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount ELSE 0 END), 0)
  INTO v_cash_in, v_cash_out FROM cash_drawer_movements
  WHERE shift_id = p_shift_id AND branch_id = p_branch_id;

  v_expected := ROUND(v_shift.opening_float + v_cash_sales - v_cash_refunds + v_cash_in - v_cash_out, 2);

  RETURN jsonb_build_object('success', true, 'shift_id', p_shift_id, 'branch_id', p_branch_id,
    'cashier_id', v_shift.cashier_id, 'opening_float', v_shift.opening_float,
    'cash_sales', ROUND(v_cash_sales, 2), 'cash_refunds', ROUND(v_cash_refunds, 2),
    'cash_in', ROUND(v_cash_in, 2), 'cash_out', ROUND(v_cash_out, 2), 'expected_cash', v_expected,
    'ledger_gross_sales', ROUND(v_ledger_sales, 2), 'ledger_refunds', ROUND(v_ledger_refunds, 2),
    'ledger_net_sales', ROUND(v_ledger_sales - v_ledger_refunds, 2),
    'cached_expected_cash', v_shift.expected_cash);
END;
$$;

CREATE OR REPLACE FUNCTION fn_close_cash_drawer_shift(
  p_shift_id UUID, p_branch_id UUID, p_cashier_id UUID, p_actual_cash NUMERIC, p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shift cash_drawer_shifts%ROWTYPE;
  v_reconciliation JSONB;
  v_expected NUMERIC(12,2);
  v_variance NUMERIC(12,2);
BEGIN
  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN RAISE EXCEPTION 'ERR_INVALID_ACTUAL_CASH: Actual cash must be non-negative'; END IF;
  SELECT * INTO v_shift FROM cash_drawer_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id AND cashier_id = p_cashier_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: Open shift not found for this cashier and branch'; END IF;

  v_reconciliation := fn_calculate_cashier_shift_ledger_reconciliation(p_shift_id, p_branch_id, p_cashier_id);
  v_expected := (v_reconciliation->>'expected_cash')::NUMERIC(12,2);
  v_variance := ROUND((p_actual_cash - v_expected) * 100) / 100;
  IF v_variance <> 0 THEN
    RAISE EXCEPTION 'ERR_SHIFT_VARIANCE_REQUIRES_APPROVAL: Expected cash %, actual cash %, variance %. Manager approval is required before closing', v_expected, p_actual_cash, v_variance;
  END IF;

  UPDATE cash_drawer_shifts SET status = 'closed', closed_at = NOW(), expected_cash = v_expected,
    actual_cash = p_actual_cash, variance = 0, closing_note = NULLIF(TRIM(p_note), ''), updated_at = NOW()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('success', true, 'closed', true, 'approval_required', false,
    'shift_id', p_shift_id, 'expected_cash', v_expected, 'actual_cash', p_actual_cash, 'variance', 0,
    'reconciliation', v_reconciliation);
END;
$$;

CREATE OR REPLACE FUNCTION fn_close_cash_drawer_shift_with_approval(
  p_shift_id UUID, p_branch_id UUID, p_cashier_id UUID, p_actual_cash NUMERIC,
  p_approver_id UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shift cash_drawer_shifts%ROWTYPE;
  v_approver_role TEXT;
  v_reconciliation JSONB;
  v_expected NUMERIC(12,2);
  v_variance NUMERIC(12,2);
BEGIN
  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN RAISE EXCEPTION 'ERR_INVALID_ACTUAL_CASH: Actual cash must be non-negative'; END IF;
  IF p_approver_id IS NULL OR p_approver_id = p_cashier_id THEN
    RAISE EXCEPTION 'ERR_SEPARATION_OF_DUTIES: Shift owner cannot approve their own variance';
  END IF;

  SELECT LOWER(COALESCE(p.role::TEXT, '')) INTO v_approver_role
  FROM profiles p WHERE p.user_id = p_approver_id OR p.id = p_approver_id
  ORDER BY CASE WHEN p.user_id = p_approver_id THEN 0 ELSE 1 END LIMIT 1;
  IF v_approver_role NOT IN ('manager', 'admin', 'super_admin', 'owner') THEN
    RAISE EXCEPTION 'ERR_VARIANCE_APPROVER_REQUIRED: Only manager/admin/super_admin/owner can approve a shift variance';
  END IF;

  SELECT * INTO v_shift FROM cash_drawer_shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id AND cashier_id = p_cashier_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: Open shift not found for this cashier and branch'; END IF;

  v_reconciliation := fn_calculate_cashier_shift_ledger_reconciliation(p_shift_id, p_branch_id, p_cashier_id);
  v_expected := (v_reconciliation->>'expected_cash')::NUMERIC(12,2);
  v_variance := ROUND((p_actual_cash - v_expected) * 100) / 100;

  UPDATE cash_drawer_shifts SET status = 'closed', closed_at = NOW(), expected_cash = v_expected,
    actual_cash = p_actual_cash, variance = v_variance,
    closing_note = CONCAT_WS(' | ', NULLIF(TRIM(p_note), ''), 'Variance approved by ' || p_approver_id::TEXT),
    updated_at = NOW() WHERE id = p_shift_id;

  INSERT INTO audit_logs(user_id, user_name, user_role, action, entity, entity_id, previous_value, new_value, details)
  VALUES (p_approver_id::TEXT, 'Variance Approver', v_approver_role, 'APPROVE_SHIFT_VARIANCE',
    'CashDrawerShift', p_shift_id::TEXT, 'status=open', 'status=closed',
    jsonb_build_object('cashier_id', p_cashier_id, 'actual_cash', p_actual_cash,
      'expected_cash', v_expected, 'variance', v_variance, 'reconciliation', v_reconciliation)::TEXT);

  RETURN jsonb_build_object('success', true, 'closed', true, 'approval_required', true,
    'shift_id', p_shift_id, 'expected_cash', v_expected, 'actual_cash', p_actual_cash,
    'variance', v_variance, 'approved_by', p_approver_id, 'approver_role', v_approver_role,
    'reconciliation', v_reconciliation);
END;
$$;

REVOKE ALL ON FUNCTION fn_calculate_cashier_shift_ledger_reconciliation(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_calculate_cashier_shift_ledger_reconciliation(UUID,UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION fn_close_cash_drawer_shift(UUID,UUID,UUID,NUMERIC,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_close_cash_drawer_shift(UUID,UUID,UUID,NUMERIC,TEXT) TO service_role;
REVOKE ALL ON FUNCTION fn_close_cash_drawer_shift_with_approval(UUID,UUID,UUID,NUMERIC,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_close_cash_drawer_shift_with_approval(UUID,UUID,UUID,NUMERIC,UUID,TEXT) TO service_role;
REVOKE ALL ON FUNCTION fn_post_order_refund_to_financial_ledger(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_post_order_refund_to_financial_ledger(UUID) TO service_role;

COMMENT ON FUNCTION fn_calculate_cashier_shift_ledger_reconciliation(UUID,UUID,UUID) IS 'Authoritative shift cash reconciliation from append-only financial ledger plus explicit cash movements.';
COMMENT ON FUNCTION fn_close_cash_drawer_shift_with_approval(UUID,UUID,UUID,NUMERIC,UUID,TEXT) IS 'Manager-approved cashier shift close for non-zero ledger variance; separation of duties is enforced.';
