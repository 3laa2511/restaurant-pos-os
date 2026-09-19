-- ==============================================================================
-- BO'SH STORE — POS CHECKOUT ↔ CASH DRAWER SHIFT BINDING
-- Migration: 20260904_014_pos_checkout_shift_binding
-- Purpose: require every POS checkout to settle against an open cashier shift.
-- ==============================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES cash_drawer_shifts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_payments_shift_id ON payments(shift_id);

-- Wrapper keeps the already-hardened atomic checkout as the single source of
-- truth for order/stock/payment settlement, while locking and validating the
-- cashier's shift in the same database transaction. If anything fails after
-- the inner checkout, PostgreSQL rolls the entire call back.
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

  RETURN v_order_result || jsonb_build_object('shift_id', v_shift_id);
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_pos_checkout(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_checkout(JSONB) TO service_role;
