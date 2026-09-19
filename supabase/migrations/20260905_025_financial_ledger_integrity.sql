-- ==============================================================================
-- BO'SH STORE — PHASE 4.9 FINANCIAL LEDGER INTEGRITY
-- Migration: 20260905_025_financial_ledger_integrity
-- ==============================================================================

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shift_id UUID,
  ADD COLUMN IF NOT EXISTS cashier_id UUID,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS card_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS wallet_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS reversal_of UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'financial_transactions'::regclass AND conname = 'financial_transactions_cash_amount_nonnegative') THEN
    ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_cash_amount_nonnegative CHECK (cash_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'financial_transactions'::regclass AND conname = 'financial_transactions_card_amount_nonnegative') THEN
    ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_card_amount_nonnegative CHECK (card_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'financial_transactions'::regclass AND conname = 'financial_transactions_wallet_amount_nonnegative') THEN
    ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_wallet_amount_nonnegative CHECK (wallet_amount >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_branch_date ON financial_transactions(branch_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_reference ON financial_transactions(reference_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_sale_order ON financial_transactions(reference_id) WHERE type = 'revenue' AND reference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_refund_ref ON financial_transactions(transaction_ref) WHERE type = 'refund';

CREATE OR REPLACE FUNCTION fn_financial_transactions_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ERR_FINANCIAL_LEDGER_IMMUTABLE: financial_transactions is append-only; use a reversal transaction instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_transactions_append_only_update ON financial_transactions;
CREATE TRIGGER trg_financial_transactions_append_only_update BEFORE UPDATE ON financial_transactions FOR EACH ROW EXECUTE FUNCTION fn_financial_transactions_append_only();
DROP TRIGGER IF EXISTS trg_financial_transactions_append_only_delete ON financial_transactions;
CREATE TRIGGER trg_financial_transactions_append_only_delete BEFORE DELETE ON financial_transactions FOR EACH ROW EXECUTE FUNCTION fn_financial_transactions_append_only();

CREATE OR REPLACE FUNCTION fn_post_order_sale_to_financial_ledger(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_cogs NUMERIC(12,2);
  v_existing UUID;
  v_payment_method TEXT;
  v_payment_amount NUMERIC(12,2) := 0;
  v_cash_amount NUMERIC(12,2) := 0;
  v_card_amount NUMERIC(12,2) := 0;
  v_wallet_amount NUMERIC(12,2) := 0;
  v_paid_rows INT := 0;
  v_distinct_methods INT := 0;
  v_channel VARCHAR(50);
  v_transaction_ref VARCHAR(100);
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_FINANCIAL_ORDER_NOT_FOUND: Order % does not exist', p_order_id; END IF;
  IF v_order.payment_status <> 'paid' THEN
    RETURN jsonb_build_object('success', true, 'posted', false, 'reason', 'ORDER_NOT_SETTLED');
  END IF;

  SELECT id INTO v_existing FROM financial_transactions WHERE type = 'revenue' AND reference_id = p_order_id::text LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'posted', false, 'existing', true, 'transaction_id', v_existing);
  END IF;

  SELECT
    COUNT(*)::INT,
    COALESCE(SUM(amount), 0)::NUMERIC(12,2),
    COALESCE(SUM(cash_amount), 0)::NUMERIC(12,2),
    COALESCE(SUM(card_amount), 0)::NUMERIC(12,2),
    COALESCE(SUM(wallet_amount), 0)::NUMERIC(12,2),
    COUNT(DISTINCT method)::INT
  INTO v_paid_rows, v_payment_amount, v_cash_amount, v_card_amount, v_wallet_amount, v_distinct_methods
  FROM payments
  WHERE order_id = p_order_id AND status = 'paid';

  IF v_paid_rows = 0 THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_PAYMENT_NOT_FOUND: Order % is marked paid but has no settled payment', p_order_id;
  END IF;

  IF ROUND(v_payment_amount * 100) <> ROUND(v_order.total * 100) THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_PAYMENT_MISMATCH: Settled payments % do not equal order total % for order %', v_payment_amount, v_order.total, p_order_id;
  END IF;

  SELECT CASE WHEN COUNT(DISTINCT method) > 1 THEN 'mixed' ELSE MAX(method::text) END
  INTO v_payment_method
  FROM payments
  WHERE order_id = p_order_id AND status = 'paid';

  -- A POS payment row already persists authoritative tender buckets. For legacy
  -- rows without a breakdown, only a single-method payment may be safely derived.
  IF v_cash_amount + v_card_amount + v_wallet_amount = 0 AND v_payment_method <> 'mixed' THEN
    IF v_payment_method IN ('pos_cash', 'cod', 'cash') THEN
      v_cash_amount := v_payment_amount;
    ELSIF v_payment_method IN ('card', 'pos_card') THEN
      v_card_amount := v_payment_amount;
    ELSIF v_payment_method IN ('wallet', 'instapay', 'pos_wallet') THEN
      v_wallet_amount := v_payment_amount;
    END IF;
  END IF;

  IF ROUND((v_cash_amount + v_card_amount + v_wallet_amount) * 100) <> ROUND(v_payment_amount * 100) THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_TENDER_MISMATCH: Tender breakdown does not equal settled payment total for order %', p_order_id;
  END IF;

  SELECT COALESCE(SUM(oi.cost_price * oi.quantity), 0)::NUMERIC(12,2) INTO v_cogs
  FROM order_items oi WHERE oi.order_id = p_order_id;

  v_channel := CASE
    WHEN v_order.source IN ('pos_cashier', 'pos_store') THEN 'pos'
    WHEN v_order.source = 'repair' THEN 'repair'
    WHEN v_order.source = 'gaming' THEN 'gaming'
    ELSE 'retail_ecommerce'
  END;
  v_transaction_ref := 'SALE-' || p_order_id::text;

  INSERT INTO financial_transactions (
    transaction_ref, channel, type, amount, cogs, net_profit, reference_id, description, date,
    branch_id, shift_id, cashier_id, payment_method, cash_amount, card_amount, wallet_amount, created_at
  ) VALUES (
    v_transaction_ref, v_channel, 'revenue', v_order.total, v_cogs, v_order.total - v_cogs, p_order_id::text,
    'Settled sale for Order #' || v_order.order_number, CURRENT_DATE, v_order.branch_id, v_order.shift_id,
    v_order.cashier_id, v_payment_method, v_cash_amount, v_card_amount, v_wallet_amount, NOW()
  ) ON CONFLICT (transaction_ref) DO NOTHING RETURNING id INTO v_existing;

  RETURN jsonb_build_object('success', true, 'posted', v_existing IS NOT NULL, 'transaction_id', v_existing,
    'order_id', p_order_id, 'revenue', v_order.total, 'settled_payments', v_payment_amount,
    'cash_amount', v_cash_amount, 'card_amount', v_card_amount, 'wallet_amount', v_wallet_amount,
    'cogs', v_cogs, 'net_profit', v_order.total - v_cogs);
END;
$$;

CREATE OR REPLACE FUNCTION fn_post_order_refund_to_financial_ledger(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_sale financial_transactions%ROWTYPE;
  v_refunded NUMERIC(12,2);
  v_remaining NUMERIC(12,2);
  v_refund_ref VARCHAR(100);
  v_refund_id UUID;
  v_cogs NUMERIC(12,2);
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_FINANCIAL_ORDER_NOT_FOUND: Order % does not exist', p_order_id; END IF;
  SELECT * INTO v_sale FROM financial_transactions WHERE type = 'revenue' AND reference_id = p_order_id::text ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_FINANCIAL_SALE_NOT_FOUND: No settled sale ledger exists for order %', p_order_id; END IF;

  SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2) INTO v_refunded FROM financial_transactions WHERE type = 'refund' AND reference_id = p_order_id::text;
  v_remaining := ROUND((v_sale.amount - v_refunded) * 100) / 100;
  IF v_remaining <= 0 THEN RETURN jsonb_build_object('success', true, 'posted', false, 'existing', true, 'remaining', 0); END IF;
  IF v_order.payment_status <> 'refunded' OR v_order.status <> 'returned' THEN
    RETURN jsonb_build_object('success', true, 'posted', false, 'reason', 'ORDER_NOT_FULLY_REFUNDED');
  END IF;

  v_refund_ref := 'REFUND-' || p_order_id::text || '-' || REPLACE(gen_random_uuid()::text, '-', '');
  SELECT COALESCE(SUM(oi.cost_price * oi.quantity), 0)::NUMERIC(12,2) INTO v_cogs FROM order_items oi WHERE oi.order_id = p_order_id;

  INSERT INTO financial_transactions (
    transaction_ref, channel, type, amount, cogs, net_profit, reference_id, description, date,
    branch_id, shift_id, cashier_id, payment_method, cash_amount, card_amount, wallet_amount, reversal_of, created_at
  ) VALUES (
    v_refund_ref,
    CASE WHEN v_order.source IN ('pos_cashier', 'pos_store') THEN 'pos' ELSE 'retail_ecommerce' END,
    'refund', v_remaining, v_cogs, -v_remaining + v_cogs, p_order_id::text,
    'Full refund reversal for Order #' || v_order.order_number, CURRENT_DATE, v_order.branch_id,
    v_order.shift_id, v_order.cashier_id, v_order.payment_method::text,
    CASE WHEN v_order.payment_method::text IN ('pos_cash','cod','cash') THEN v_remaining ELSE 0 END,
    CASE WHEN v_order.payment_method::text IN ('card','pos_card') THEN v_remaining ELSE 0 END,
    CASE WHEN v_order.payment_method::text IN ('wallet','instapay','pos_wallet') THEN v_remaining ELSE 0 END,
    v_sale.id, NOW()
  ) RETURNING id INTO v_refund_id;

  RETURN jsonb_build_object('success', true, 'posted', true, 'transaction_id', v_refund_id,
    'refund_amount', v_remaining, 'reversed_sale_id', v_sale.id);
END;
$$;

CREATE OR REPLACE FUNCTION fn_financial_settlement_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM fn_post_order_sale_to_financial_ledger(NEW.order_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_financial_post_on_paid_payment ON payments;
CREATE TRIGGER trg_financial_post_on_paid_payment AFTER INSERT OR UPDATE OF status ON payments FOR EACH ROW WHEN (NEW.status = 'paid') EXECUTE FUNCTION fn_financial_settlement_trigger();

CREATE OR REPLACE FUNCTION fn_financial_order_status_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS DISTINCT FROM NEW.payment_status) THEN
    PERFORM fn_post_order_sale_to_financial_ledger(NEW.id);
  END IF;
  IF NEW.payment_status = 'refunded' AND (OLD.payment_status IS DISTINCT FROM NEW.payment_status) THEN
    PERFORM fn_post_order_refund_to_financial_ledger(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_financial_post_on_order_payment_status ON orders;
CREATE TRIGGER trg_financial_post_on_order_payment_status AFTER UPDATE OF payment_status ON orders FOR EACH ROW EXECUTE FUNCTION fn_financial_order_status_trigger();

ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE financial_transactions FROM anon, authenticated;
GRANT SELECT ON TABLE financial_transactions TO service_role;
REVOKE ALL ON FUNCTION fn_post_order_sale_to_financial_ledger(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_post_order_sale_to_financial_ledger(UUID) TO service_role;
REVOKE ALL ON FUNCTION fn_post_order_refund_to_financial_ledger(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_post_order_refund_to_financial_ledger(UUID) TO service_role;

COMMENT ON TABLE financial_transactions IS 'Append-only financial ledger. Sales/refunds are posted transactionally from authoritative order/payment state; corrections use reversal entries.';
