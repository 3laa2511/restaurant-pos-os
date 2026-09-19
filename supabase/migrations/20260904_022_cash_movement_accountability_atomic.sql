-- ==============================================================================
-- BO'SH STORE — ATOMIC CASH MOVEMENT ACCOUNTABILITY
-- Migration: 20260904_022_cash_movement_accountability_atomic
-- Purpose:
--   Bind cash movement + expected cash + risk events + audit log to one DB transaction.
--   If risk/audit persistence fails, the financial movement is rolled back.
--   The existing RPC name is preserved so the current API remains backward compatible.
-- ==============================================================================

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

  INSERT INTO cash_drawer_movements(shift_id,branch_id,cashier_id,type,amount,reason)
  VALUES(p_shift_id,p_branch_id,p_cashier_id,p_type,p_amount,v_reason)
  RETURNING id INTO v_movement_id;

  UPDATE cash_drawer_shifts
  SET expected_cash = expected_cash + CASE WHEN p_type='cash_in' THEN p_amount ELSE -p_amount END,
      updated_at=NOW()
  WHERE id=p_shift_id;

  SELECT opening_float INTO v_opening_float
  FROM cash_drawer_shifts
  WHERE id=p_shift_id;

  SELECT COUNT(*)::INT INTO v_cash_out_count
  FROM cash_drawer_movements
  WHERE shift_id=p_shift_id AND type='cash_out';

  SELECT COALESCE(p.name,'Cashier'), p.role::TEXT
  INTO v_cashier_name, v_cashier_role
  FROM profiles p
  WHERE p.user_id=p_cashier_id AND p.is_active=true
  LIMIT 1;
  v_cashier_name := COALESCE(v_cashier_name,'Cashier');
  v_cashier_role := COALESCE(v_cashier_role,'cashier');

  -- Deterministic risk rules are evaluated after the authoritative movement,
  -- but before the RPC returns. Any INSERT failure aborts the whole transaction.
  IF p_type='cash_out' THEN
    IF p_amount >= 1500 THEN
      v_risk_level := 'critical';
    ELSIF p_amount >= 500 OR (v_opening_float > 0 AND p_amount >= v_opening_float * 0.5) THEN
      v_risk_level := 'high';
    END IF;

    IF p_amount >= 500 OR (v_opening_float > 0 AND p_amount >= v_opening_float * 0.5) THEN
      INSERT INTO risk_events (
        id, branch_id, cashier_id, cashier_name, shift_id,
        event_type, severity, risk_score, entity_type, entity_id,
        amount, reason, evidence, status, dedup_key, created_at
      ) VALUES (
        gen_random_uuid(), p_branch_id, p_cashier_id, v_cashier_name, p_shift_id,
        'LARGE_CASH_OUT', v_risk_level,
        CASE WHEN p_amount >= 1500 THEN 70 ELSE 50 END,
        'CashDrawerMovement', v_movement_id::TEXT, p_amount,
        format('Large cash withdrawal of %s EGP recorded (Float: %s EGP). Reason: %s.', p_amount, v_opening_float, v_reason),
        jsonb_build_object('amount',p_amount,'openingFloat',v_opening_float,'reason',v_reason),
        'open', 'LARGE_CASH_OUT:CashDrawerMovement:'||v_movement_id::TEXT, v_now
      )
      ON CONFLICT (dedup_key) WHERE status IN ('open','acknowledged') DO NOTHING;

      v_risk_events := v_risk_events || jsonb_build_array(jsonb_build_object(
        'event_type','LARGE_CASH_OUT',
        'severity',v_risk_level,
        'risk_score',CASE WHEN p_amount >= 1500 THEN 70 ELSE 50 END
      ));
    END IF;

    IF v_cash_out_count >= 3 THEN
      INSERT INTO risk_events (
        id, branch_id, cashier_id, cashier_name, shift_id,
        event_type, severity, risk_score, entity_type, entity_id,
        amount, reason, evidence, status, dedup_key, created_at
      ) VALUES (
        gen_random_uuid(), p_branch_id, p_cashier_id, v_cashier_name, p_shift_id,
        'EXCESSIVE_CASH_OUT_FREQUENCY', 'high', 55,
        'CashDrawerMovement', v_movement_id::TEXT, p_amount,
        format('Cashier performed %s cash-out transactions in this shift, exceeding standard limit.', v_cash_out_count),
        jsonb_build_object('cashOutCount',v_cash_out_count,'limit',3),
        'open', 'EXCESSIVE_CASH_OUT_FREQUENCY:CashDrawerMovement:'||v_movement_id::TEXT, v_now
      )
      ON CONFLICT (dedup_key) WHERE status IN ('open','acknowledged') DO NOTHING;

      v_risk_events := v_risk_events || jsonb_build_array(jsonb_build_object(
        'event_type','EXCESSIVE_CASH_OUT_FREQUENCY','severity','high','risk_score',55
      ));
    END IF;
  END IF;

  -- Audit is mandatory and transactional. Failure rolls back movement + drawer update.
  INSERT INTO audit_logs (
    user_id,user_name,user_role,cashier_id,branch_id,shift_id,
    action,entity,entity_id,reason,financial_impact,risk_level,details,created_at
  ) VALUES (
    p_cashier_id::TEXT,v_cashier_name,v_cashier_role,p_cashier_id::TEXT,p_branch_id,p_shift_id,
    CASE WHEN p_type='cash_in' THEN 'CASH_IN' ELSE 'CASH_OUT' END,
    'CashDrawerMovement',v_movement_id::TEXT,v_reason,
    CASE WHEN p_type='cash_in' THEN p_amount ELSE -p_amount END,
    v_risk_level,
    jsonb_build_object(
      'movementId',v_movement_id,
      'amount',p_amount,
      'type',p_type,
      'expectedCash',(SELECT expected_cash FROM cash_drawer_shifts WHERE id=p_shift_id),
      'riskEvents',v_risk_events
    )::TEXT,
    v_now
  );

  RETURN jsonb_build_object(
    'success',true,
    'shift_id',p_shift_id,
    'movement_id',v_movement_id,
    'expected_cash',(SELECT expected_cash FROM cash_drawer_shifts WHERE id=p_shift_id),
    'risk_level',v_risk_level,
    'risk_events',v_risk_events
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_record_cash_drawer_movement(UUID,UUID,UUID,TEXT,NUMERIC,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_record_cash_drawer_movement(UUID,UUID,UUID,TEXT,NUMERIC,TEXT) TO service_role;
