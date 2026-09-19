-- ==============================================================================
-- BO'SH STORE — POS LEDGER SOURCE GUARD
-- Migration: 20260906_035_pos_ledger_source_guard
-- Purpose: correct migration 034 so only POS payments with an unbound shift are
-- deferred. Online/non-POS paid payments must continue to post immediately.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_financial_settlement_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_pos BOOLEAN := false;
BEGIN
  SELECT source IN ('pos_cashier', 'pos_store')
  INTO v_is_pos
  FROM orders
  WHERE id = NEW.order_id;

  IF NEW.status = 'paid'
     AND v_is_pos
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

COMMENT ON FUNCTION fn_financial_settlement_trigger() IS 'Posts paid non-POS payments immediately; defers only unbound POS payments until cashier-shift binding.';
