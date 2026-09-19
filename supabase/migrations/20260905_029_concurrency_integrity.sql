-- ==============================================================================
-- BO'SH STORE — PHASE 4.9 CONCURRENCY & RACE-CONDITION INTEGRITY
-- Migration: 20260905_029_concurrency_integrity
-- Purpose: serialize financial mutations against payment/refund/shift-close races.
-- ==============================================================================

-- A POS payment already locks its parent order in migration 026. This migration
-- adds the second lock domain: the cashier shift. Closing a shift must serialize
-- against every financial mutation that can change its expected cash.
CREATE OR REPLACE FUNCTION fn_lock_pos_shift_for_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_shift_id UUID;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_ORDER_NOT_FOUND: Order % does not exist', NEW.order_id;
  END IF;

  IF v_order.source IN ('pos_cashier', 'pos_store') THEN
    v_shift_id := v_order.shift_id;
    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'ERR_POS_SHIFT_REQUIRED: POS payment requires an assigned cashier shift';
    END IF;

    PERFORM 1
    FROM cash_drawer_shifts
    WHERE id = v_shift_id
      AND branch_id = v_order.branch_id
      AND cashier_id = v_order.cashier_id
      AND status = 'open'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_POS_SHIFT_NOT_OPEN: POS payment cannot settle against a closed or invalid cashier shift';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_pos_shift_for_payment ON payments;
CREATE TRIGGER trg_lock_pos_shift_for_payment
BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION fn_lock_pos_shift_for_payment();

-- Cash drawer movements participate in the same shift lock domain. This prevents
-- cash-in/cash-out from committing concurrently with a shift close and being
-- omitted from the authoritative reconciliation snapshot.
CREATE OR REPLACE FUNCTION fn_lock_shift_for_cash_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift cash_drawer_shifts%ROWTYPE;
BEGIN
  SELECT * INTO v_shift
  FROM cash_drawer_shifts
  WHERE id = NEW.shift_id
    AND branch_id = NEW.branch_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_NOT_OPEN_FOR_CASH_MOVEMENT: Cash movement requires an open shift in the same branch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_shift_for_cash_movement ON cash_drawer_movements;
CREATE TRIGGER trg_lock_shift_for_cash_movement
BEFORE INSERT OR UPDATE ON cash_drawer_movements
FOR EACH ROW
EXECUTE FUNCTION fn_lock_shift_for_cash_movement();

-- Refund settlement must lock the refunding shift before the refund ledger is
-- posted. The 028 ledger function reads this authoritative settlement row, so
-- the lock closes the race between refund completion and shift close.
CREATE OR REPLACE FUNCTION fn_lock_shift_for_refund_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift cash_drawer_shifts%ROWTYPE;
BEGIN
  IF NEW.shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_SHIFT_REQUIRED: POS refund settlement requires an assigned cashier shift';
  END IF;

  SELECT * INTO v_shift
  FROM cash_drawer_shifts
  WHERE id = NEW.shift_id
    AND branch_id = NEW.branch_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REFUND_SHIFT_NOT_OPEN: Refund settlement requires an open cashier shift in the same branch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_shift_for_refund_settlement ON payment_refunds;
CREATE TRIGGER trg_lock_shift_for_refund_settlement
BEFORE INSERT OR UPDATE ON payment_refunds
FOR EACH ROW
EXECUTE FUNCTION fn_lock_shift_for_refund_settlement();

-- Explicit transaction-level advisory locks provide a stable lock domain for
-- callers that need to coordinate the same order across multiple tables without
-- depending on lock acquisition order between application transactions.
CREATE OR REPLACE FUNCTION fn_lock_financial_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_ORDER_LOCK_KEY_REQUIRED: Order lock key is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:financial-order:' || p_order_id::text, 0));
END;
$$;

CREATE OR REPLACE FUNCTION fn_lock_financial_shift(p_shift_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_SHIFT_LOCK_KEY_REQUIRED: Shift lock key is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:financial-shift:' || p_shift_id::text, 0));
END;
$$;

REVOKE ALL ON FUNCTION fn_lock_financial_order(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_lock_financial_order(UUID) TO service_role;
REVOKE ALL ON FUNCTION fn_lock_financial_shift(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_lock_financial_shift(UUID) TO service_role;

COMMENT ON FUNCTION fn_lock_financial_order(UUID) IS 'Transaction-scoped advisory lock for same-order financial concurrency.';
COMMENT ON FUNCTION fn_lock_financial_shift(UUID) IS 'Transaction-scoped advisory lock for same-shift financial concurrency.';
