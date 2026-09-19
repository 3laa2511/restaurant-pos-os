-- ==============================================================================
-- BO'SH STORE — PHASE 4.9 PAYMENT TENDER IMMUTABILITY & CASH EXACTNESS
-- Migration: 20260905_030_payment_tender_immutability
-- Purpose: close remaining payment-integrity gaps discovered during concurrency audit.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_validate_payment_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_existing_paid NUMERIC(12,2) := 0;
  v_breakdown NUMERIC(12,2) := 0;
  v_cash_delta NUMERIC(12,2) := 0;
  v_is_pos BOOLEAN := false;
BEGIN
  IF NEW.amount <= 0 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AMOUNT_INVALID: Payment amount must be greater than zero';
  END IF;

  IF NEW.cash_amount < 0 OR NEW.card_amount < 0 OR NEW.wallet_amount < 0
     OR NEW.cash_tendered < 0 OR NEW.change_amount < 0 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_BREAKDOWN_INVALID: Payment tender values cannot be negative';
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_ORDER_NOT_FOUND: Order % does not exist', NEW.order_id;
  END IF;

  v_is_pos := v_order.source IN ('pos_cashier', 'pos_store');

  -- A settled payment is immutable in every financially meaningful field,
  -- including its idempotency key. Reversals/refunds are separate facts.
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.transaction_ref IS DISTINCT FROM OLD.transaction_ref
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.cash_amount IS DISTINCT FROM OLD.cash_amount
       OR NEW.card_amount IS DISTINCT FROM OLD.card_amount
       OR NEW.wallet_amount IS DISTINCT FROM OLD.wallet_amount
       OR NEW.cash_tendered IS DISTINCT FROM OLD.cash_tendered
       OR NEW.change_amount IS DISTINCT FROM OLD.change_amount THEN
      RAISE EXCEPTION 'ERR_PAID_PAYMENT_IMMUTABLE: Settled payment rows cannot be edited; use a reversal/refund flow';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'paid' THEN
    SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2)
    INTO v_existing_paid
    FROM payments
    WHERE order_id = NEW.order_id
      AND status = 'paid'
      AND id <> NEW.id;

    IF ROUND((v_existing_paid + NEW.amount) * 100) > ROUND(v_order.total * 100) THEN
      RAISE EXCEPTION 'ERR_PAYMENT_OVERSETTLEMENT: Settled payments % would exceed order total %',
        v_existing_paid + NEW.amount, v_order.total;
    END IF;

    IF v_is_pos THEN
      v_breakdown := NEW.cash_amount + NEW.card_amount + NEW.wallet_amount;
      IF ROUND(v_breakdown * 100) <> ROUND(NEW.amount * 100) THEN
        RAISE EXCEPTION 'ERR_PAYMENT_BREAKDOWN_MISMATCH: POS tender breakdown % must equal payment amount %',
          v_breakdown, NEW.amount;
      END IF;

      -- Cash tender is only meaningful for the cash portion and must cover it.
      -- Change is exactly the excess cash handed over beyond the cash portion.
      IF NEW.cash_tendered = 0 AND NEW.cash_amount > 0 THEN
        RAISE EXCEPTION 'ERR_PAYMENT_TENDER_INSUFFICIENT: Cash tender is required for a cash payment portion';
      END IF;

      IF NEW.cash_tendered < NEW.cash_amount THEN
        RAISE EXCEPTION 'ERR_PAYMENT_TENDER_INSUFFICIENT: Cash tendered % is below cash portion %',
          NEW.cash_tendered, NEW.cash_amount;
      END IF;

      v_cash_delta := ROUND((NEW.cash_tendered - NEW.cash_amount) * 100) / 100;
      IF ROUND(NEW.change_amount * 100) <> ROUND(v_cash_delta * 100) THEN
        RAISE EXCEPTION 'ERR_PAYMENT_CHANGE_MISMATCH: Change amount must equal cash tendered minus cash portion';
      END IF;

      IF NEW.cash_amount = 0 AND NEW.cash_tendered <> 0 THEN
        RAISE EXCEPTION 'ERR_PAYMENT_CASH_TENDER_WITHOUT_CASH_PORTION: Cash tender cannot exist without a cash payment portion';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_payment_settlement ON payments;
CREATE TRIGGER trg_validate_payment_settlement
BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION fn_validate_payment_settlement();

COMMENT ON FUNCTION fn_validate_payment_settlement() IS 'Concurrency-safe payment validation with parent-order locking, paid-row immutability including idempotency, exact POS tender breakdown, and exact cash change validation.';
