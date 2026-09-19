-- ==============================================================================
-- BO'SH STORE — CASH DRAWER / SHIFT MANAGEMENT
-- Migration: 20260903_013_cash_drawer_shift_management
-- Purpose: server-authoritative cash accountability for POS shifts.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS cash_drawer_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  cashier_id UUID NOT NULL,
  cashier_name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opening_float NUMERIC(12,2) NOT NULL CHECK (opening_float >= 0),
  expected_cash NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (expected_cash >= 0),
  actual_cash NUMERIC(12,2),
  variance NUMERIC(12,2),
  closing_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_drawer_closed_fields CHECK (
    (status = 'open' AND closed_at IS NULL) OR
    (status = 'closed' AND closed_at IS NOT NULL AND actual_cash IS NOT NULL AND variance IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_drawer_one_open_per_cashier
  ON cash_drawer_shifts(cashier_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS ix_cash_drawer_branch_status
  ON cash_drawer_shifts(branch_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES cash_drawer_shifts(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL,
  cashier_id UUID NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('cash_in','cash_out','opening_float','sale_cash','refund_cash','closing_adjustment')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  reference_type VARCHAR(50),
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_cash_drawer_movements_shift
  ON cash_drawer_movements(shift_id, created_at);

CREATE OR REPLACE FUNCTION fn_open_cash_drawer_shift(
  p_branch_id UUID,
  p_cashier_id UUID,
  p_cashier_name TEXT,
  p_opening_float NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift cash_drawer_shifts;
BEGIN
  IF p_opening_float IS NULL OR p_opening_float < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_OPENING_FLOAT: Opening float must be non-negative';
  END IF;

  INSERT INTO cash_drawer_shifts(branch_id,cashier_id,cashier_name,opening_float,expected_cash)
  VALUES(p_branch_id,p_cashier_id,COALESCE(NULLIF(TRIM(p_cashier_name),''),'Cashier'),p_opening_float,p_opening_float)
  RETURNING * INTO v_shift;

  INSERT INTO cash_drawer_movements(shift_id,branch_id,cashier_id,type,amount,reason)
  VALUES(v_shift.id,p_branch_id,p_cashier_id,'opening_float',p_opening_float,'Opening cash float');

  RETURN jsonb_build_object('success',true,'shift_id',v_shift.id,'status',v_shift.status,'opening_float',v_shift.opening_float,'expected_cash',v_shift.expected_cash);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'ERR_SHIFT_ALREADY_OPEN: This cashier already has an open cash drawer shift';
END;
$$;

CREATE OR REPLACE FUNCTION fn_record_cash_drawer_movement(
  p_shift_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID,
  p_type TEXT,
  p_amount NUMERIC,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift cash_drawer_shifts;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'ERR_INVALID_CASH_AMOUNT: Amount must be greater than zero'; END IF;
  IF p_type NOT IN ('cash_in','cash_out') THEN RAISE EXCEPTION 'ERR_INVALID_CASH_MOVEMENT: Only cash_in or cash_out is allowed'; END IF;

  SELECT * INTO v_shift FROM cash_drawer_shifts
  WHERE id=p_shift_id AND branch_id=p_branch_id AND cashier_id=p_cashier_id AND status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: Open shift not found for this cashier and branch'; END IF;

  IF p_type='cash_out' AND p_amount > v_shift.expected_cash THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_DRAWER_CASH: Cash out exceeds expected drawer cash';
  END IF;

  INSERT INTO cash_drawer_movements(shift_id,branch_id,cashier_id,type,amount,reason)
  VALUES(p_shift_id,p_branch_id,p_cashier_id,p_type,p_amount,COALESCE(NULLIF(TRIM(p_reason),''),'Cash drawer movement'));

  UPDATE cash_drawer_shifts
  SET expected_cash = expected_cash + CASE WHEN p_type='cash_in' THEN p_amount ELSE -p_amount END,
      updated_at=NOW()
  WHERE id=p_shift_id;

  RETURN jsonb_build_object('success',true,'shift_id',p_shift_id,'expected_cash',(SELECT expected_cash FROM cash_drawer_shifts WHERE id=p_shift_id));
END;
$$;

CREATE OR REPLACE FUNCTION fn_close_cash_drawer_shift(
  p_shift_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID,
  p_actual_cash NUMERIC,
  p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift cash_drawer_shifts; v_expected NUMERIC(12,2); v_variance NUMERIC(12,2);
BEGIN
  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN RAISE EXCEPTION 'ERR_INVALID_ACTUAL_CASH: Actual cash must be non-negative'; END IF;

  SELECT * INTO v_shift FROM cash_drawer_shifts
  WHERE id=p_shift_id AND branch_id=p_branch_id AND cashier_id=p_cashier_id AND status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_SHIFT_NOT_FOUND: Open shift not found for this cashier and branch'; END IF;

  -- Reconcile from authoritative payment records plus explicit drawer movements.
  SELECT v_shift.opening_float
    + COALESCE((SELECT SUM(CASE WHEN m.type='cash_in' THEN m.amount WHEN m.type='cash_out' THEN -m.amount ELSE 0 END)
               FROM cash_drawer_movements m WHERE m.shift_id=v_shift.id),0)
    + COALESCE((SELECT SUM(p.cash_amount)
               FROM payments p JOIN orders o ON o.id=p.order_id
               WHERE p.status='paid' AND p.cash_amount>0
                 AND o.source IN ('pos_cashier','pos_store')
                 AND p.created_at >= v_shift.opened_at
                 AND o.created_at >= v_shift.opened_at),0)
    - COALESCE((SELECT SUM(p.change_amount)
               FROM payments p JOIN orders o ON o.id=p.order_id
               WHERE p.status='paid' AND p.change_amount>0
                 AND o.source IN ('pos_cashier','pos_store')
                 AND p.created_at >= v_shift.opened_at
                 AND o.created_at >= v_shift.opened_at),0)
  INTO v_expected;

  v_expected := ROUND(v_expected,2);
  v_variance := ROUND(p_actual_cash - v_expected,2);

  UPDATE cash_drawer_shifts
  SET status='closed', closed_at=NOW(), expected_cash=v_expected,
      actual_cash=p_actual_cash, variance=v_variance,
      closing_note=NULLIF(TRIM(p_note),''), updated_at=NOW()
  WHERE id=v_shift.id;

  RETURN jsonb_build_object('success',true,'shift_id',v_shift.id,'expected_cash',v_expected,'actual_cash',p_actual_cash,'variance',v_variance,'closed_at',NOW());
END;
$$;

CREATE OR REPLACE FUNCTION fn_get_open_cash_drawer_shift(p_branch_id UUID,p_cashier_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift cash_drawer_shifts;
BEGIN
  SELECT * INTO v_shift FROM cash_drawer_shifts WHERE branch_id=p_branch_id AND cashier_id=p_cashier_id AND status='open' LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'open',false); END IF;
  RETURN jsonb_build_object('success',true,'open',true,'shift_id',v_shift.id,'opened_at',v_shift.opened_at,'opening_float',v_shift.opening_float,'expected_cash',v_shift.expected_cash);
END;
$$;

REVOKE ALL ON FUNCTION fn_open_cash_drawer_shift(UUID,UUID,TEXT,NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_record_cash_drawer_movement(UUID,UUID,UUID,TEXT,NUMERIC,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_close_cash_drawer_shift(UUID,UUID,UUID,NUMERIC,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_get_open_cash_drawer_shift(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_open_cash_drawer_shift(UUID,UUID,TEXT,NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION fn_record_cash_drawer_movement(UUID,UUID,UUID,TEXT,NUMERIC,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_close_cash_drawer_shift(UUID,UUID,UUID,NUMERIC,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_get_open_cash_drawer_shift(UUID,UUID) TO service_role;
