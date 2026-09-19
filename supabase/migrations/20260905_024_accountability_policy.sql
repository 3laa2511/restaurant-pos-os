-- ==============================================================================
-- BO'SH STORE — DB-BACKED ACCOUNTABILITY & RISK POLICY
-- Migration: 20260905_024_accountability_policy
-- Purpose:
--   1. Create accountability_policies table for centralized, database-backed thresholds
--   2. Support global defaults (branch_id IS NULL) and branch-specific overrides
--   3. Enforce strict check constraints, status flags, and auditability
--   4. Lock down table to service_role (server-only boundary)
--   5. Provide authoritative SQL functions for deterministic policy resolution
--   6. Update atomic checkout and cash movement RPCs to resolve policies dynamically
-- ==============================================================================

-- 1. Create accountability_policies table
CREATE TABLE IF NOT EXISTS accountability_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key VARCHAR(100) NOT NULL,
  policy_group VARCHAR(50) NOT NULL,
  numeric_value NUMERIC(12,4),
  boolean_value BOOLEAN,
  text_value TEXT,
  json_value JSONB,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  branch_id UUID NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_by UUID NULL,
  updated_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_policy_key_not_empty CHECK (length(trim(policy_key)) > 0),
  CONSTRAINT chk_policy_group CHECK (policy_group IN ('discount', 'cash_movement', 'refund', 'reprint', 'variance', 'risk_score')),
  CONSTRAINT chk_numeric_value_finite CHECK (numeric_value IS NULL OR numeric_value >= 0)
);

-- 2. Indexes for fast deterministic resolution & uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_accountability_policies_global 
  ON accountability_policies (policy_key) 
  WHERE branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accountability_policies_branch 
  ON accountability_policies (policy_key, branch_id) 
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accountability_policies_lookup 
  ON accountability_policies (policy_key, branch_id, is_active);

CREATE INDEX IF NOT EXISTS idx_accountability_policies_group 
  ON accountability_policies (policy_group, is_active);

-- 3. RLS Lockdown: Server-side only, no direct browser access
ALTER TABLE accountability_policies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE accountability_policies FROM anon, authenticated;
GRANT ALL ON TABLE accountability_policies TO service_role;

COMMENT ON TABLE accountability_policies IS 
  'Centralized anti-theft and risk policy thresholds. Service-role only; access is mediated by the authenticated API and PostgreSQL functions.';

-- 4. Seed authoritative global default policies
INSERT INTO accountability_policies (policy_key, policy_group, numeric_value, description, is_active, branch_id)
VALUES
  ('DISCOUNT_MAX_UNAPPROVED_PERCENT', 'discount', 10.0000, 'Cashier discount limit percentage without manager approval', true, NULL),
  ('DISCOUNT_MAX_UNAPPROVED_AMOUNT', 'discount', 200.0000, 'Cashier discount limit amount in EGP without manager approval', true, NULL),
  ('DISCOUNT_RISK_HIGH_PERCENT', 'discount', 20.0000, 'Discount percentage triggering high risk event', true, NULL),
  ('DISCOUNT_RISK_CRITICAL_PERCENT', 'discount', 35.0000, 'Discount percentage triggering critical risk event', true, NULL),
  ('DISCOUNT_RISK_MAX_COUNT_PER_SHIFT', 'discount', 5.0000, 'Maximum discounted sales per shift before risk event', true, NULL),
  ('CASH_OUT_HIGH_THRESHOLD', 'cash_movement', 500.0000, 'Cash-out amount in EGP triggering high risk event', true, NULL),
  ('CASH_OUT_CRITICAL_THRESHOLD', 'cash_movement', 1500.0000, 'Cash-out amount in EGP triggering critical risk event', true, NULL),
  ('CASH_OUT_MAX_PER_SHIFT', 'cash_movement', 3.0000, 'Maximum cash-outs per shift before excessive frequency risk event', true, NULL),
  ('REFUND_HIGH_THRESHOLD', 'refund', 1000.0000, 'High-value refund threshold in EGP', true, NULL),
  ('REFUND_CRITICAL_THRESHOLD', 'refund', 3000.0000, 'Critical-value refund threshold in EGP', true, NULL),
  ('REFUND_RAPID_COUNT_THRESHOLD', 'refund', 3.0000, 'Rapid consecutive refunds count threshold within 1 hour', true, NULL),
  ('REFUND_SHORT_SALE_MINUTES', 'refund', 5.0000, 'Minutes since checkout under which refund is considered immediate/suspicious', true, NULL),
  ('REFUND_HIGH_RATIO_PERCENT', 'refund', 30.0000, 'Shift refund-to-sales ratio percentage threshold (30%)', true, NULL),
  ('REFUND_AFTER_CASHOUT_MINUTES', 'refund', 15.0000, 'Minutes after drawer cash-out under which refund is flagged', true, NULL),
  ('VARIANCE_MINOR_THRESHOLD', 'variance', 1.0000, 'Minor drawer variance threshold in EGP', true, NULL),
  ('VARIANCE_SIGNIFICANT_THRESHOLD', 'variance', 50.0000, 'Significant drawer variance threshold in EGP', true, NULL),
  ('VARIANCE_LARGE_THRESHOLD', 'variance', 300.0000, 'Large drawer variance threshold in EGP triggering critical event', true, NULL),
  ('REPRINT_RISK_THRESHOLD', 'reprint', 3.0000, 'Receipt reprint count threshold for warning/high risk', true, NULL),
  ('REPRINT_RISK_CRITICAL', 'reprint', 5.0000, 'Receipt reprint count threshold for critical risk', true, NULL),
  ('RISK_SCORE_HIGH_THRESHOLD', 'risk_score', 50.0000, 'Cashier aggregate risk score threshold for HIGH tier', true, NULL),
  ('RISK_SCORE_CRITICAL_THRESHOLD', 'risk_score', 75.0000, 'Cashier aggregate risk score threshold for CRITICAL tier', true, NULL)
ON CONFLICT DO NOTHING;

-- 5. Helper function: fn_get_effective_accountability_policy
-- Deterministic resolution:
--   1. Active branch-specific policy (branch_id = p_branch_id AND is_active = true)
--   2. Active global default (branch_id IS NULL AND is_active = true)
--   3. Returns NULL if not found
CREATE OR REPLACE FUNCTION fn_get_effective_accountability_policy(
  p_policy_key TEXT,
  p_branch_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy accountability_policies%ROWTYPE;
BEGIN
  -- 1. Try active branch override if branch_id is provided
  IF p_branch_id IS NOT NULL THEN
    SELECT * INTO v_policy
    FROM accountability_policies
    WHERE policy_key = p_policy_key
      AND branch_id = p_branch_id
      AND is_active = true
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'id', v_policy.id,
        'policy_key', v_policy.policy_key,
        'policy_group', v_policy.policy_group,
        'numeric_value', v_policy.numeric_value,
        'boolean_value', v_policy.boolean_value,
        'text_value', v_policy.text_value,
        'json_value', v_policy.json_value,
        'description', v_policy.description,
        'is_active', v_policy.is_active,
        'branch_id', v_policy.branch_id,
        'is_branch_override', true
      );
    END IF;
  END IF;

  -- 2. Try active global default
  SELECT * INTO v_policy
  FROM accountability_policies
  WHERE policy_key = p_policy_key
    AND branch_id IS NULL
    AND is_active = true
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_policy.id,
      'policy_key', v_policy.policy_key,
      'policy_group', v_policy.policy_group,
      'numeric_value', v_policy.numeric_value,
      'boolean_value', v_policy.boolean_value,
      'text_value', v_policy.text_value,
      'json_value', v_policy.json_value,
      'description', v_policy.description,
      'is_active', v_policy.is_active,
      'branch_id', NULL,
      'is_branch_override', false
    );
  END IF;

  RETURN NULL;
END;
$$;

-- 6. Helper function: fn_get_effective_numeric_policy
CREATE OR REPLACE FUNCTION fn_get_effective_numeric_policy(
  p_policy_key TEXT,
  p_branch_id UUID DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num NUMERIC(12,4);
BEGIN
  -- 1. Branch-specific
  IF p_branch_id IS NOT NULL THEN
    SELECT numeric_value INTO v_num
    FROM accountability_policies
    WHERE policy_key = p_policy_key
      AND branch_id = p_branch_id
      AND is_active = true
    LIMIT 1;

    IF v_num IS NOT NULL THEN
      RETURN v_num;
    END IF;
  END IF;

  -- 2. Global default
  SELECT numeric_value INTO v_num
  FROM accountability_policies
  WHERE policy_key = p_policy_key
    AND branch_id IS NULL
    AND is_active = true
  LIMIT 1;

  RETURN v_num;
END;
$$;

-- Grant execution to service_role only
REVOKE ALL ON FUNCTION fn_get_effective_accountability_policy(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_get_effective_accountability_policy(TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION fn_get_effective_numeric_policy(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_get_effective_numeric_policy(TEXT, UUID) TO service_role;

-- 7. Update fn_atomic_pos_checkout to resolve discount policies dynamically from DB
CREATE OR REPLACE FUNCTION fn_atomic_pos_checkout(
  p_order_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_result JSONB;
  v_order_id UUID;
  v_order RECORD;
  v_cashier_id UUID;
  v_branch_id UUID;
  v_shift_id UUID;
  v_subtotal NUMERIC(12,2) := 0;
  v_discount NUMERIC(12,2) := 0;
  v_discount_percent NUMERIC(12,2) := 0;
  v_approval_id UUID := NULL;
  v_approval_record RECORD;
  v_candidate_approval RECORD;
  v_cashier_role TEXT := NULL;
  v_is_manager BOOLEAN := false;
  v_max_unapproved_percent NUMERIC(12,4);
  v_max_unapproved_amount NUMERIC(12,4);
BEGIN
  -- 1. Execute base checkout transaction atomically
  v_order_result := fn_atomic_pos_checkout_base(p_order_payload);
  v_order_id := (v_order_result->>'order_id')::UUID;

  -- Reload authoritative persisted order record
  SELECT id, branch_id, cashier_id, shift_id, subtotal, discount, total
  INTO v_order
  FROM orders
  WHERE id = v_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ORDER_MISSING: Order record % could not be reloaded', v_order_id;
  END IF;

  v_branch_id := v_order.branch_id;
  v_cashier_id := v_order.cashier_id;
  v_shift_id := v_order.shift_id;
  v_subtotal := v_order.subtotal;
  v_discount := v_order.discount;
  v_discount_percent := CASE WHEN v_subtotal > 0 THEN (v_discount / v_subtotal) * 100.0 ELSE 0 END;

  -- Authoritative Manager Resolution from active profile in PostgreSQL
  SELECT p.role INTO v_cashier_role
  FROM profiles p
  WHERE p.user_id = v_cashier_id AND p.is_active = true
  LIMIT 1;

  v_is_manager := (v_cashier_role IN ('owner', 'admin', 'store_manager', 'manager'));

  -- Dynamic Policy Resolution: discount thresholds
  v_max_unapproved_percent := fn_get_effective_numeric_policy('DISCOUNT_MAX_UNAPPROVED_PERCENT', v_branch_id);
  v_max_unapproved_amount := fn_get_effective_numeric_policy('DISCOUNT_MAX_UNAPPROVED_AMOUNT', v_branch_id);

  IF v_max_unapproved_percent IS NULL OR v_max_unapproved_amount IS NULL THEN
    RAISE EXCEPTION 'ERR_ACCOUNTABILITY_POLICY_UNAVAILABLE: Required discount policies are missing';
  END IF;

  -- 2. Extract or locate approval request
  IF p_order_payload->>'approval_id' IS NOT NULL AND p_order_payload->>'approval_id' <> '' THEN
    v_approval_id := (p_order_payload->>'approval_id')::UUID;
  END IF;

  IF v_approval_id IS NULL AND v_discount > 0 AND NOT v_is_manager THEN
    SELECT ar.id INTO v_candidate_approval
    FROM approval_requests ar
    WHERE ar.requested_by = v_cashier_id::TEXT
      AND ar.branch_id = v_branch_id
      AND (ar.shift_id IS NULL OR ar.shift_id = v_shift_id)
      AND ar.operation_type = 'DISCOUNT_APPLY'
      AND ar.status = 'approved'
      AND ar.expires_at > NOW()
      AND (ar.entity_id IS NULL OR ar.entity_id::TEXT = v_order_id::TEXT)
      AND COALESCE(ar.requested_amount, 0) >= v_discount
    ORDER BY ar.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_approval_id := v_candidate_approval.id;
    END IF;
  END IF;

  -- 3. Enforce policy threshold
  IF v_approval_id IS NULL AND v_discount > 0 AND NOT v_is_manager
     AND (v_discount_percent > v_max_unapproved_percent OR v_discount > v_max_unapproved_amount) THEN
    RAISE EXCEPTION 'ERR_MANAGER_APPROVAL_REQUIRED: Discount exceeds allowed threshold (% percent or % EGP) and requires manager approval',
      v_max_unapproved_percent, v_max_unapproved_amount;
  END IF;

  -- 4. Consume approval request if present
  IF v_approval_id IS NOT NULL THEN
    PERFORM fn_consume_approval_request(
      v_approval_id,
      v_order_id,
      v_cashier_id,
      v_branch_id,
      v_shift_id,
      'DISCOUNT_APPLY',
      v_discount
    );
  END IF;

  RETURN v_order_result;
END;
$$;

-- 8. Update fn_record_cash_drawer_movement to resolve cash-out policies dynamically
CREATE OR REPLACE FUNCTION fn_record_cash_drawer_movement(
  p_shift_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID,
  p_type TEXT,
  p_amount NUMERIC,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift cash_drawer_shifts;
  v_movement_id UUID;
  v_opening_float NUMERIC(12,2);
  v_cash_out_count INT;
  v_cashier_name TEXT;
  v_cashier_role TEXT;
  v_risk_level TEXT := 'normal';
  v_risk_events JSONB := '[]'::JSONB;
  v_reason TEXT := COALESCE(NULLIF(TRIM(p_reason), ''), 'Cash drawer movement');
  v_now TIMESTAMPTZ := NOW();
  v_cash_out_high_thresh NUMERIC(12,4);
  v_cash_out_crit_thresh NUMERIC(12,4);
  v_cash_out_max_count NUMERIC(12,4);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_CASH_AMOUNT: Amount must be greater than zero';
  END IF;
  IF p_type NOT IN ('cash_in','cash_out') THEN
    RAISE EXCEPTION 'ERR_INVALID_CASH_MOVEMENT: Only cash_in or cash_out is allowed';
  END IF;

  SELECT * INTO v_shift
  FROM cash_drawer_shifts
  WHERE id=p_shift_id AND branch_id=p_branch_id AND cashier_id=p_cashier_id AND status='open'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: Open shift not found for this cashier and branch';
  END IF;

  IF p_type='cash_out' AND p_amount > v_shift.expected_cash THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_DRAWER_CASH: Cash out exceeds expected drawer cash';
  END IF;

  SELECT full_name, role INTO v_cashier_name, v_cashier_role
  FROM profiles
  WHERE user_id=p_cashier_id;

  v_movement_id := gen_random_uuid();
  v_opening_float := COALESCE(v_shift.opening_float, 0);

  -- Insert movement ledger row
  INSERT INTO cash_drawer_movements(
    id, shift_id, branch_id, cashier_id, type, amount, reason, created_at
  ) VALUES (
    v_movement_id, p_shift_id, p_branch_id, p_cashier_id, p_type, p_amount, v_reason, v_now
  );

  -- Mutate drawer running balance
  IF p_type='cash_in' THEN
    UPDATE cash_drawer_shifts
    SET expected_cash = expected_cash + p_amount,
        updated_at = v_now
    WHERE id=p_shift_id;
  ELSE
    UPDATE cash_drawer_shifts
    SET expected_cash = expected_cash - p_amount,
        updated_at = v_now
    WHERE id=p_shift_id;
  END IF;

  -- Dynamic Policy Resolution for cash-out risk evaluation
  IF p_type = 'cash_out' THEN
    v_cash_out_high_thresh := fn_get_effective_numeric_policy('CASH_OUT_HIGH_THRESHOLD', p_branch_id);
    v_cash_out_crit_thresh := fn_get_effective_numeric_policy('CASH_OUT_CRITICAL_THRESHOLD', p_branch_id);
    v_cash_out_max_count := fn_get_effective_numeric_policy('CASH_OUT_MAX_PER_SHIFT', p_branch_id);

    IF v_cash_out_high_thresh IS NULL OR v_cash_out_crit_thresh IS NULL OR v_cash_out_max_count IS NULL THEN
      RAISE EXCEPTION 'ERR_ACCOUNTABILITY_POLICY_UNAVAILABLE: Required cash-out policies are missing';
    END IF;

    SELECT COUNT(*) INTO v_cash_out_count
    FROM cash_drawer_movements
    WHERE shift_id=p_shift_id AND type='cash_out';

    IF p_amount >= v_cash_out_crit_thresh THEN
      v_risk_level := 'critical';
    ELSIF p_amount >= v_cash_out_high_thresh OR (v_opening_float > 0 AND p_amount >= v_opening_float * 0.5) THEN
      v_risk_level := 'high';
    END IF;

    IF v_risk_level IN ('high','critical') THEN
      INSERT INTO risk_events (
        id, branch_id, cashier_id, cashier_name, shift_id, event_type, severity, risk_score,
        entity_type, entity_id, amount, dedup_key, reason, evidence, status, created_at
      ) VALUES (
        gen_random_uuid(), p_branch_id, p_cashier_id::TEXT, COALESCE(v_cashier_name, 'Cashier'), p_shift_id::TEXT,
        'LARGE_CASH_OUT', v_risk_level,
        CASE WHEN p_amount >= v_cash_out_crit_thresh THEN 70 ELSE 50 END,
        'CashDrawerMovement', v_movement_id::TEXT, p_amount,
        'LARGE_CASH_OUT:CashDrawerMovement:' || v_movement_id::TEXT,
        'Large cash withdrawal of ' || p_amount || ' EGP recorded.',
        jsonb_build_object(
          'amount', p_amount,
          'opening_float', v_opening_float,
          'reason', v_reason,
          'threshold', v_cash_out_high_thresh,
          'critical_threshold', v_cash_out_crit_thresh,
          'risk_score', CASE WHEN p_amount >= v_cash_out_crit_thresh THEN 70 ELSE 50 END
        ),
        'open', v_now
      );
    END IF;

    IF v_cash_out_count >= v_cash_out_max_count THEN
      INSERT INTO risk_events (
        id, branch_id, cashier_id, cashier_name, shift_id, event_type, severity, risk_score,
        entity_type, entity_id, amount, dedup_key, reason, evidence, status, created_at
      ) VALUES (
        gen_random_uuid(), p_branch_id, p_cashier_id::TEXT, COALESCE(v_cashier_name, 'Cashier'), p_shift_id::TEXT,
        'EXCESSIVE_CASH_OUT_FREQUENCY', 'high', 55,
        'CashDrawerMovement', v_movement_id::TEXT, p_amount,
        'EXCESSIVE_CASH_OUT_FREQUENCY:CashDrawerMovement:' || v_movement_id::TEXT,
        'Cashier performed ' || v_cash_out_count || ' cash-out transactions in this shift.',
        jsonb_build_object(
          'cash_out_count', v_cash_out_count,
          'limit', v_cash_out_max_count
        ),
        'open', v_now
      );
    END IF;
  END IF;

  -- Transactional audit log insertion
  INSERT INTO audit_logs (
    id, user_id, user_name, user_role, cashier_id, branch_id, shift_id,
    action, entity, entity_id, reason, financial_impact, risk_level, details, timestamp
  ) VALUES (
    gen_random_uuid(), p_cashier_id::TEXT, COALESCE(v_cashier_name, 'Cashier'), COALESCE(v_cashier_role, 'cashier'),
    p_cashier_id::TEXT, p_branch_id::TEXT, p_shift_id::TEXT,
    CASE WHEN p_type='cash_in' THEN 'CASH_IN' ELSE 'CASH_OUT' END,
    'CashDrawerMovement', v_movement_id::TEXT, v_reason,
    p_amount, v_risk_level,
    jsonb_build_object(
      'amount', p_amount,
      'movement_type', p_type,
      'reason', v_reason,
      'opening_float', v_opening_float
    )::TEXT,
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'movement_id', v_movement_id,
    'shift_id', p_shift_id,
    'type', p_type,
    'amount', p_amount,
    'risk_level', v_risk_level
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_record_cash_drawer_movement FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_record_cash_drawer_movement TO service_role;
