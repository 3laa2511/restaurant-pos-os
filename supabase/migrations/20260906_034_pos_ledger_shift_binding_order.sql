-- ==============================================================================
-- BO'SH STORE — POS LEDGER ↔ SHIFT BINDING ORDERING
-- Migration: 20260906_034_pos_ledger_shift_binding_order
-- Purpose: prevent a paid POS payment from posting its financial ledger row
-- before the POS wrapper has atomically bound the payment to its cashier shift.
-- ==============================================================================

-- POS payments are inserted by fn_atomic_checkout before fn_atomic_pos_checkout
-- binds shift_id. The old AFTER INSERT settlement trigger could therefore create
-- a revenue ledger row with a NULL shift_id. Defer POS ledger posting until the
-- authoritative shift binding update; non-POS payments retain immediate posting.
CREATE OR REPLACE FUNCTION fn_financial_settlement_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND NEW.method IN ('pos_cash', 'card', 'wallet', 'instapay', 'mixed')
     AND NEW.shift_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'paid' THEN
    PERFORM fn_post_order_sale_to_financial_ledger(NEW.order_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_post_on_paid_payment ON payments;
CREATE TRIGGER trg_financial_post_on_paid_payment
AFTER INSERT OR UPDATE OF status ON payments
FOR EACH ROW WHEN (NEW.status = 'paid')
EXECUTE FUNCTION fn_financial_settlement_trigger();

-- POS shift binding is the point at which the payment becomes financially
-- attributable to a cashier/branch shift. Post exactly once after that binding.
CREATE OR REPLACE FUNCTION fn_post_pos_payment_to_financial_ledger(p_payment_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_existing UUID;
  v_cogs NUMERIC(12,2) := 0;
  v_payment_method TEXT;
  v_channel TEXT;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_PAYMENT_NOT_FOUND: Payment % does not exist', p_payment_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_payment.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_ORDER_NOT_FOUND: Order % does not exist', v_payment.order_id;
  END IF;

  IF v_order.source NOT IN ('pos_cashier', 'pos_store') THEN
    RETURN fn_post_order_sale_to_financial_ledger(v_order.id);
  END IF;
  IF v_payment.status <> 'paid' THEN
    RETURN jsonb_build_object('success', true, 'posted', false, 'reason', 'PAYMENT_NOT_SETTLED');
  END IF;
  IF v_payment.shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_SHIFT_BINDING_MISSING: POS payment must be shift-bound before financial ledger posting';
  END IF;

  SELECT id INTO v_existing FROM financial_transactions
  WHERE type = 'revenue' AND reference_id = v_order.id::text LIMIT 1;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM financial_transactions WHERE id = v_existing AND shift_id IS NULL) THEN
      RAISE EXCEPTION 'ERR_FINANCIAL_LEDGER_SHIFT_MISSING: Existing POS sale ledger row is not attributed to a cashier shift';
    END IF;
    RETURN jsonb_build_object('success', true, 'posted', false, 'existing', true, 'transaction_id', v_existing);
  END IF;

  SELECT COALESCE(SUM(oi.cost_price * oi.quantity), 0)::NUMERIC(12,2)
  INTO v_cogs FROM order_items oi WHERE oi.order_id = v_order.id;

  v_payment_method := v_payment.method::TEXT;
  v_channel := 'pos';

  INSERT INTO financial_transactions (
    transaction_ref, channel, type, amount, cogs, net_profit, reference_id,
    description, date, branch_id, shift_id, cashier_id, payment_method,
    cash_amount, card_amount, wallet_amount, created_at
  ) VALUES (
    'SALE-' || v_order.id::text, v_channel, 'revenue', v_order.total,
    v_cogs, v_order.total - v_cogs, v_order.id::text,
    'Settled POS sale for Order #' || v_order.order_number, CURRENT_DATE,
    v_payment.branch_id, v_payment.shift_id, v_payment.cashier_id,
    v_payment_method, v_payment.cash_amount, v_payment.card_amount,
    v_payment.wallet_amount, NOW()
  )
  ON CONFLICT (transaction_ref) DO NOTHING
  RETURNING id INTO v_existing;

  RETURN jsonb_build_object('success', true, 'posted', v_existing IS NOT NULL,
    'transaction_id', v_existing, 'order_id', v_order.id, 'shift_id', v_payment.shift_id);
END;
$$;

CREATE OR REPLACE FUNCTION fn_financial_pos_shift_binding_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid'
     AND NEW.shift_id IS NOT NULL
     AND (OLD.shift_id IS DISTINCT FROM NEW.shift_id)
     AND NEW.method IN ('pos_cash', 'card', 'wallet', 'instapay', 'mixed') THEN
    PERFORM fn_post_pos_payment_to_financial_ledger(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_post_on_pos_shift_binding ON payments;
CREATE TRIGGER trg_financial_post_on_pos_shift_binding
AFTER UPDATE OF shift_id ON payments
FOR EACH ROW EXECUTE FUNCTION fn_financial_pos_shift_binding_trigger();

REVOKE ALL ON FUNCTION fn_post_pos_payment_to_financial_ledger(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_post_pos_payment_to_financial_ledger(UUID) TO service_role;

COMMENT ON FUNCTION fn_post_pos_payment_to_financial_ledger(UUID) IS 'Posts POS revenue only after the payment is atomically bound to an open cashier shift, preventing unassigned POS ledger entries.';
