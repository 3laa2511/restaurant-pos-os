-- ==============================================================================
-- BO'SH STORE — PHASE 4.9 DISTRIBUTED POS IDEMPOTENCY AUTHORITY
-- Migration: 20260906_031_pos_idempotency_authority
-- Purpose: make POS payment idempotency database-authoritative across instances.
-- ==============================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency_key
  ON payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_atomic_pos_checkout(p_order_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_order_id UUID;
  v_order_number TEXT;
  v_idempotency_key TEXT;
  v_existing_payment payments%ROWTYPE;
BEGIN
  v_order_number := NULLIF(TRIM(p_order_payload->>'order_number'), '');
  v_idempotency_key := NULLIF(TRIM(p_order_payload->>'idempotency_key'), '');

  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REQUIRED: POS checkout requires an Idempotency-Key';
  END IF;

  IF LENGTH(v_idempotency_key) > 255 THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_INVALID: Idempotency-Key exceeds 255 characters';
  END IF;

  -- Serialize the same idempotency key across all application instances.
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-idempotency:' || v_idempotency_key, 0));

  SELECT * INTO v_existing_payment
  FROM payments
  WHERE idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_order_number IS NOT NULL AND EXISTS (
      SELECT 1 FROM orders WHERE id = v_existing_payment.order_id AND order_number <> v_order_number
    ) THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REUSE: Idempotency-Key is bound to a different order';
    END IF;

    SELECT jsonb_build_object(
      'success', true,
      'existing', true,
      'order_id', o.id,
      'order_number', o.order_number,
      'total', o.total,
      'payment_status', o.payment_status,
      'payment_id', p.id,
      'idempotency_key', p.idempotency_key
    ) INTO v_result
    FROM orders o
    JOIN payments p ON p.order_id = o.id
    WHERE p.id = v_existing_payment.id;

    RETURN v_result;
  END IF;

  -- Keep the already-authoritative POS shift/order/payment transaction intact.
  v_result := fn_atomic_checkout(p_order_payload || jsonb_build_object('source', 'pos_cashier'));
  v_order_id := NULLIF(v_result->>'order_id', '')::UUID;

  UPDATE payments
  SET idempotency_key = v_idempotency_key
  WHERE order_id = v_order_id
    AND idempotency_key IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_BINDING_FAILED: POS payment could not be bound to the idempotency key';
  END IF;

  RETURN v_result || jsonb_build_object('idempotency_key', v_idempotency_key);
EXCEPTION
  WHEN unique_violation THEN
    -- Another transaction can only win this key if a future implementation changes
    -- the lock domain. Re-read the authoritative payment instead of creating a second fact.
    SELECT * INTO v_existing_payment
    FROM payments
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      SELECT jsonb_build_object(
        'success', true,
        'existing', true,
        'order_id', o.id,
        'order_number', o.order_number,
        'total', o.total,
        'payment_status', o.payment_status,
        'payment_id', p.id,
        'idempotency_key', p.idempotency_key
      ) INTO v_result
      FROM orders o JOIN payments p ON p.order_id = o.id
      WHERE p.id = v_existing_payment.id;
      RETURN v_result;
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_pos_checkout(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_checkout(JSONB) TO service_role;

COMMENT ON FUNCTION fn_atomic_pos_checkout(JSONB) IS 'Distributed-idempotent POS checkout: database-authoritative idempotency serialization plus existing atomic order/payment/inventory/shift settlement.';
