-- ==============================================================================
-- BO'SH STORE — PHASE 4.9 REFUND TENDER REVERSAL INTEGRITY
-- Migration: 20260905_027_refund_tender_reversal_integrity
-- Purpose: refund reversals inherit the authoritative tender allocation from the
--          original sale ledger instead of guessing from orders.payment_method.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_post_order_refund_to_financial_ledger(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_sale financial_transactions%ROWTYPE;
  v_refunded NUMERIC(12,2);
  v_remaining NUMERIC(12,2);
  v_refund_ref VARCHAR(100);
  v_refund_id UUID;
  v_cogs NUMERIC(12,2);
  v_ratio NUMERIC(18,10) := 1;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_ORDER_NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  SELECT * INTO v_sale
  FROM financial_transactions
  WHERE type = 'revenue' AND reference_id = p_order_id::text
  ORDER BY created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_SALE_NOT_FOUND: No settled sale ledger exists for order %', p_order_id;
  END IF;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2)
  INTO v_refunded
  FROM financial_transactions
  WHERE type = 'refund' AND reference_id = p_order_id::text;

  v_remaining := ROUND((v_sale.amount - v_refunded) * 100) / 100;

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'posted', false, 'existing', true, 'remaining', 0);
  END IF;

  IF v_order.payment_status <> 'refunded' OR v_order.status <> 'returned' THEN
    RETURN jsonb_build_object('success', true, 'posted', false, 'reason', 'ORDER_NOT_FULLY_REFUNDED');
  END IF;

  IF v_sale.amount > 0 THEN
    v_ratio := v_remaining / v_sale.amount;
  END IF;

  v_refund_ref := 'REFUND-' || p_order_id::text || '-' || REPLACE(gen_random_uuid()::text, '-', '');

  SELECT COALESCE(SUM(oi.cost_price * oi.quantity), 0)::NUMERIC(12,2)
  INTO v_cogs
  FROM order_items oi
  WHERE oi.order_id = p_order_id;

  INSERT INTO financial_transactions (
    transaction_ref, channel, type, amount, cogs, net_profit, reference_id, description, date,
    branch_id, shift_id, cashier_id, payment_method, cash_amount, card_amount, wallet_amount,
    reversal_of, created_at
  ) VALUES (
    v_refund_ref,
    v_sale.channel,
    'refund',
    v_remaining,
    v_cogs,
    -v_remaining + v_cogs,
    p_order_id::text,
    'Refund reversal for Order #' || v_order.order_number,
    CURRENT_DATE,
    v_sale.branch_id,
    v_sale.shift_id,
    v_sale.cashier_id,
    v_sale.payment_method,
    ROUND(v_sale.cash_amount * v_ratio * 100) / 100,
    ROUND(v_sale.card_amount * v_ratio * 100) / 100,
    ROUND(v_sale.wallet_amount * v_ratio * 100) / 100,
    v_sale.id,
    NOW()
  )
  RETURNING id INTO v_refund_id;

  RETURN jsonb_build_object(
    'success', true,
    'posted', true,
    'transaction_id', v_refund_id,
    'refund_amount', v_remaining,
    'cash_amount', ROUND(v_sale.cash_amount * v_ratio * 100) / 100,
    'card_amount', ROUND(v_sale.card_amount * v_ratio * 100) / 100,
    'wallet_amount', ROUND(v_sale.wallet_amount * v_ratio * 100) / 100,
    'reversed_sale_id', v_sale.id
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_post_order_refund_to_financial_ledger(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_post_order_refund_to_financial_ledger(UUID) TO service_role;
