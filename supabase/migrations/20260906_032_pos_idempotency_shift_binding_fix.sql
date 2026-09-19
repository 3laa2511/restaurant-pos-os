-- ==============================================================================
-- BO'SH STORE — PHASE 4.9 POS IDEMPOTENCY + SHIFT BINDING CORRECTION
-- Migration: 20260906_032_pos_idempotency_shift_binding_fix
-- Purpose: preserve the authoritative POS shift-binding contract while adding
-- database-authoritative distributed idempotency.
-- ==============================================================================

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
  v_idempotency_key TEXT;
  v_existing_payment payments%ROWTYPE;
BEGIN
  IF COALESCE(NULLIF(p_order_payload->>'source', ''), '') NOT IN ('pos_cashier', 'pos_store') THEN
    RAISE EXCEPTION 'ERR_POS_SOURCE_REQUIRED: POS checkout source is required';
  END IF;

  v_idempotency_key := NULLIF(TRIM(p_order_payload->>'idempotency_key'), '');
  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REQUIRED: POS checkout requires an Idempotency-Key';
  END IF;
  IF LENGTH(v_idempotency_key) > 255 THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_INVALID: Idempotency-Key exceeds 255 characters';
  END IF;

  -- One authoritative serialization domain across every application instance.
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-idempotency:' || v_idempotency_key, 0));

  SELECT * INTO v_existing_payment
  FROM payments
  WHERE idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    SELECT o.id, o.source, p.shift_id
      INTO v_order_id, v_existing_source, v_payment_shift_id
    FROM orders o
    JOIN payments p ON p.order_id = o.id
    WHERE p.id = v_existing_payment.id
    FOR UPDATE OF o;

    IF v_existing_source NOT IN ('pos_cashier', 'pos_store') THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REUSE: Idempotency-Key belongs to a non-POS order';
    END IF;
    IF v_payment_shift_id IS NULL THEN
      RAISE EXCEPTION 'ERR_SHIFT_BINDING_MISSING: Existing POS payment is missing its cash drawer shift binding';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'existing', true,
      'order_id', v_order_id,
      'order_number', (SELECT order_number FROM orders WHERE id = v_order_id),
      'total', (SELECT total FROM orders WHERE id = v_order_id),
      'payment_status', (SELECT payment_status::text FROM orders WHERE id = v_order_id),
      'payment_id', v_existing_payment.id,
      'shift_id', v_payment_shift_id,
      'idempotency_key', v_idempotency_key
    );
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

  -- Lock the shift before creating any financial fact. Shift close uses the same
  -- row lock, so close cannot race this settlement.
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

  UPDATE payments
  SET shift_id = v_shift_id,
      idempotency_key = v_idempotency_key
  WHERE order_id = v_order_id
    AND shift_id IS NULL
    AND idempotency_key IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_POS_PAYMENT_BINDING_FAILED: POS payment could not be atomically bound to shift and idempotency key';
  END IF;

  RETURN v_order_result || jsonb_build_object(
    'shift_id', v_shift_id,
    'idempotency_key', v_idempotency_key
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing_payment
    FROM payments
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'existing', true,
        'order_id', v_existing_payment.order_id,
        'order_number', (SELECT order_number FROM orders WHERE id = v_existing_payment.order_id),
        'total', (SELECT total FROM orders WHERE id = v_existing_payment.order_id),
        'payment_status', (SELECT payment_status::text FROM orders WHERE id = v_existing_payment.order_id),
        'payment_id', v_existing_payment.id,
        'shift_id', v_existing_payment.shift_id,
        'idempotency_key', v_idempotency_key
      );
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_pos_checkout(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_checkout(JSONB) TO service_role;

COMMENT ON FUNCTION fn_atomic_pos_checkout(JSONB) IS 'POS checkout preserving open-shift binding while serializing and persisting idempotency at the database layer.';
