-- ==============================================================================
-- BO'SH STORE — REFUND LIFECYCLE HARDENING
-- Migration: 20260909_038_refund_lifecycle_hardening
-- Purpose: make POS refunds idempotent and approval-aware without weakening the
-- existing atomic refund transaction or changing its full-refund semantics.
-- ============================================================================

ALTER TABLE payment_refunds
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refunds_idempotency_key
  ON payment_refunds(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Six-argument wrapper is intentionally additive: existing five-argument callers
-- remain compatible while the hardened API can bind a durable idempotency key and
-- an optional manager approval to the same database transaction.
CREATE OR REPLACE FUNCTION fn_atomic_pos_refund_hardened(
  p_order_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID,
  p_shift_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_approval_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing payment_refunds%ROWTYPE;
  v_order orders%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_refund_result JSONB;
  v_refund_amount NUMERIC(12,2);
  v_high_threshold NUMERIC(12,4);
  v_critical_threshold NUMERIC(12,4);
  v_is_manager BOOLEAN := false;
  v_role TEXT;
BEGIN
  IF p_order_id IS NULL OR p_branch_id IS NULL OR p_cashier_id IS NULL OR p_shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_CONTEXT_REQUIRED: Order, branch, cashier and shift are required';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    p_idempotency_key := NULLIF(TRIM(p_idempotency_key), '');
    IF p_idempotency_key IS NOT NULL AND LENGTH(p_idempotency_key) > 255 THEN
      RAISE EXCEPTION 'ERR_REFUND_IDEMPOTENCY_KEY_INVALID: Idempotency-Key exceeds 255 characters';
    END IF;
  END IF;

  -- Serialize retries for the same refund operation before reading any state.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'boshi:pos-refund:' || COALESCE(p_idempotency_key, p_order_id::TEXT), 0
  ));

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM payment_refunds
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.order_id <> p_order_id
         OR v_existing.branch_id <> p_branch_id
         OR v_existing.cashier_id <> p_cashier_id THEN
        RAISE EXCEPTION 'ERR_REFUND_IDEMPOTENCY_REUSE: Idempotency-Key is bound to a different refund context';
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'existing', true,
        'order_id', v_existing.order_id,
        'refund_ledger_id', v_existing.id,
        'refund_amount', v_existing.refund_amount,
        'cash_refund_amount', v_existing.cash_refund_amount,
        'non_cash_refund_amount', v_existing.non_cash_refund_amount,
        'shift_id', v_existing.shift_id,
        'idempotency_key', v_existing.idempotency_key
      );
    END IF;
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id AND branch_id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REFUND_ORDER_NOT_FOUND: POS order was not found in this branch';
  END IF;

  IF v_order.source NOT IN ('pos_cashier', 'pos_store') THEN
    RAISE EXCEPTION 'ERR_POS_REFUND_REQUIRED: Only POS orders can use the POS refund settlement path';
  END IF;

  SELECT * INTO v_payment
  FROM payments
  WHERE order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'paid' THEN
    RAISE EXCEPTION 'ERR_REFUND_PAYMENT_NOT_SETTLED: Only a paid POS payment can be refunded';
  END IF;

  v_refund_amount := ROUND(COALESCE(v_payment.paid_amount, v_payment.amount, 0), 2);
  IF v_refund_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_REFUND_AMOUNT: Authoritative payment amount must be greater than zero';
  END IF;

  SELECT fn_get_effective_numeric_policy('REFUND_HIGH_THRESHOLD', p_branch_id),
         fn_get_effective_numeric_policy('REFUND_CRITICAL_THRESHOLD', p_branch_id)
    INTO v_high_threshold, v_critical_threshold;

  IF v_high_threshold IS NULL OR v_critical_threshold IS NULL THEN
    RAISE EXCEPTION 'ERR_ACCOUNTABILITY_POLICY_UNAVAILABLE: Required refund policies are missing';
  END IF;

  SELECT p.role::TEXT INTO v_role
  FROM profiles p
  WHERE (p.user_id = p_cashier_id OR p.id = p_cashier_id) AND p.is_active = true
  ORDER BY CASE WHEN p.user_id = p_cashier_id THEN 0 ELSE 1 END
  LIMIT 1;
  v_is_manager := COALESCE(v_role IN ('owner', 'admin', 'store_manager', 'manager'), false);

  -- High and critical refunds require a separately approved request unless the
  -- authenticated actor is a manager-level role. fn_consume_approval_request
  -- enforces branch, shift, order, expiry, amount and separation of duties.
  IF v_refund_amount >= v_high_threshold AND NOT v_is_manager THEN
    IF p_approval_id IS NULL THEN
      RAISE EXCEPTION 'ERR_REFUND_APPROVAL_REQUIRED: High-value POS refunds require manager approval';
    END IF;
  END IF;

  IF v_refund_amount >= v_critical_threshold AND NOT v_is_manager AND p_approval_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_CRITICAL_APPROVAL_REQUIRED: Critical POS refunds require manager approval';
  END IF;

  IF p_approval_id IS NOT NULL THEN
    PERFORM fn_consume_approval_request(
      p_approval_id,
      p_cashier_id::VARCHAR,
      p_branch_id,
      p_shift_id,
      'REFUND_ORDER',
      v_refund_amount,
      p_order_id
    );
  END IF;

  -- The existing five-argument RPC remains the single owner of inventory,
  -- serialized-device, payment, drawer, durable refund-ledger and audit writes.
  v_refund_result := fn_atomic_pos_refund(
    p_order_id, p_branch_id, p_cashier_id, p_shift_id, p_reason
  );

  IF p_idempotency_key IS NOT NULL THEN
    UPDATE payment_refunds
    SET idempotency_key = p_idempotency_key
    WHERE id = (v_refund_result->>'refund_ledger_id')::UUID
      AND idempotency_key IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_REFUND_IDEMPOTENCY_BINDING_FAILED: Refund ledger could not be bound to the Idempotency-Key';
    END IF;
  END IF;

  RETURN v_refund_result || jsonb_build_object('idempotency_key', p_idempotency_key);
EXCEPTION
  WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL THEN
      SELECT * INTO v_existing
      FROM payment_refunds
      WHERE idempotency_key = p_idempotency_key
      LIMIT 1;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'success', true,
          'existing', true,
          'order_id', v_existing.order_id,
          'refund_ledger_id', v_existing.id,
          'refund_amount', v_existing.refund_amount,
          'cash_refund_amount', v_existing.cash_refund_amount,
          'non_cash_refund_amount', v_existing.non_cash_refund_amount,
          'shift_id', v_existing.shift_id,
          'idempotency_key', v_existing.idempotency_key
        );
      END IF;
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_pos_refund_hardened(UUID,UUID,UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_refund_hardened(UUID,UUID,UUID,UUID,TEXT,TEXT,UUID) TO service_role;

COMMENT ON FUNCTION fn_atomic_pos_refund_hardened(UUID,UUID,UUID,UUID,TEXT,TEXT,UUID) IS
'Idempotent, approval-aware POS refund wrapper around the existing atomic refund transaction. Full-refund semantics remain unchanged.';
