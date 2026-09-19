-- ==============================================================================
-- BO'SH STORE — PHASE 4.7: CASHIER ACCOUNTABILITY HARDENING & SECURITY CONSTRAINTS
-- Migration: 20260904_018_cashier_accountability_hardening
-- Purpose: 
--   1. Strict DB-level separation of duties constraint (no self-approval)
--   2. Authoritative approval consumption ('consumed' status, exact order binding)
--   3. Manager branch isolation enforcement in approval & risk review RPCs
--   4. Concurrent race-condition protection on receipt reprint (FOR UPDATE lock)
--   5. Controlled risk event review transitions and canonical audit actions
--   6. Authoritative movement ID return on cash drawer movements
-- ==============================================================================

-- 1. HARDEN APPROVAL_REQUESTS TABLE
DO $$
BEGIN
  -- Update check constraint on status to include 'consumed'
  ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_status_check;
  ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_status_check 
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'consumed'));

  -- Add consumption columns
  ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;
  ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS consumed_by_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

  -- Separation of duties check constraint
  ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS chk_approval_separation_of_duties;
  ALTER TABLE approval_requests ADD CONSTRAINT chk_approval_separation_of_duties 
    CHECK (approved_by IS NULL OR requested_by <> approved_by);
END $$;

CREATE INDEX IF NOT EXISTS idx_approval_requests_consumed ON approval_requests(consumed_by_order_id);

-- 2. HARDEN RISK_EVENTS TABLE FOR DEDUPLICATION
ALTER TABLE risk_events ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_events_dedup ON risk_events(dedup_key) WHERE status IN ('open', 'acknowledged');

-- 3. HARDENED ATOMIC RECEIPT REPRINT FUNCTION WITH ROW LOCK
CREATE OR REPLACE FUNCTION fn_record_receipt_reprint(
  p_order_id UUID,
  p_branch_id UUID,
  p_cashier_id VARCHAR,
  p_cashier_name VARCHAR,
  p_shift_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_reprint_count INT;
  v_risk_level VARCHAR(20) := 'normal';
  v_reprint_id UUID;
BEGIN
  -- 1. Validate order exists and belongs to branch WITH ROW LOCK to prevent concurrent reprint race conditions
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
    AND branch_id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ORDER_NOT_FOUND: Order does not exist or does not belong to this branch';
  END IF;

  -- 2. Count existing reprints for this order under lock
  SELECT COUNT(*) INTO v_reprint_count
  FROM order_receipt_reprints
  WHERE order_id = p_order_id;

  v_reprint_count := v_reprint_count + 1;

  IF v_reprint_count >= 5 THEN
    v_risk_level := 'critical';
  ELSIF v_reprint_count >= 3 THEN
    v_risk_level := 'high';
  ELSIF v_reprint_count = 2 THEN
    v_risk_level := 'medium';
  END IF;

  -- 3. Record reprint row
  INSERT INTO order_receipt_reprints (
    order_id, branch_id, cashier_id, cashier_name,
    shift_id, reason, reprint_number
  ) VALUES (
    p_order_id, p_branch_id, p_cashier_id, COALESCE(p_cashier_name, 'Cashier'),
    p_shift_id, COALESCE(NULLIF(TRIM(p_reason), ''), 'Customer copy request'),
    v_reprint_count
  ) RETURNING id INTO v_reprint_id;

  -- 4. Record audit log entry inside the same authoritative transaction
  INSERT INTO audit_logs (
    user_id, user_name, user_role, cashier_id, branch_id, shift_id,
    action, entity, entity_id, reason, risk_level, details
  ) VALUES (
    p_cashier_id, COALESCE(p_cashier_name, 'Cashier'), 'cashier',
    p_cashier_id, p_branch_id, p_shift_id,
    'RECEIPT_REPRINT', 'Order', p_order_id::TEXT,
    p_reason, v_risk_level,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'reprint_number', v_reprint_count,
      'reprint_id', v_reprint_id
    )::TEXT
  );

  RETURN jsonb_build_object(
    'success', true,
    'reprint_id', v_reprint_id,
    'reprint_number', v_reprint_count,
    'risk_level', v_risk_level,
    'order_id', p_order_id
  );
END;
$$;

-- 4. HARDENED ATOMIC MANAGER APPROVAL DECISION WITH BRANCH ISOLATION
CREATE OR REPLACE FUNCTION fn_review_approval_request(
  p_approval_id UUID,
  p_reviewer_id VARCHAR,
  p_reviewer_name VARCHAR,
  p_reviewer_role VARCHAR,
  p_decision VARCHAR, -- 'approved' or 'rejected'
  p_decision_note TEXT DEFAULT NULL,
  p_reviewer_branch_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
  v_audit_action VARCHAR(50);
BEGIN
  -- Validate reviewer role
  IF p_reviewer_role NOT IN ('owner', 'admin', 'store_manager', 'manager') THEN
    RAISE EXCEPTION 'ERR_UNAUTHORIZED_APPROVER: Only managers, store managers, admins, and owners can review approval requests';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'ERR_INVALID_DECISION: Decision must be approved or rejected';
  END IF;

  SELECT * INTO v_req
  FROM approval_requests
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_APPROVAL_NOT_FOUND: Approval request not found';
  END IF;

  -- Strict branch isolation: non-global managers cannot review approvals from other branches
  IF p_reviewer_role NOT IN ('owner', 'admin') AND (p_reviewer_branch_id IS NULL OR v_req.branch_id <> p_reviewer_branch_id) THEN
    RAISE EXCEPTION 'ERR_BRANCH_ACCESS_DENIED: Manager cannot review approvals for another branch';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'ERR_APPROVAL_ALREADY_RESOLVED: Approval request is already %', v_req.status;
  END IF;

  IF v_req.expires_at < NOW() THEN
    UPDATE approval_requests SET status = 'expired' WHERE id = p_approval_id;
    RAISE EXCEPTION 'ERR_APPROVAL_EXPIRED: Approval request has expired';
  END IF;

  -- CRITICAL ANTI-THEFT INVARIANT: Separation of duties
  IF v_req.requested_by = p_reviewer_id THEN
    RAISE EXCEPTION 'ERR_SELF_APPROVAL: Requesters cannot approve their own approval requests';
  END IF;

  IF p_decision = 'approved' THEN
    UPDATE approval_requests
    SET status = 'approved',
        approved_by = p_reviewer_id,
        approver_name = p_reviewer_name,
        approved_at = NOW(),
        decision_note = p_decision_note
    WHERE id = p_approval_id;
    v_audit_action := 'APPROVAL_APPROVE';
  ELSE
    UPDATE approval_requests
    SET status = 'rejected',
        rejected_by = p_reviewer_id,
        rejecter_name = p_reviewer_name,
        rejected_at = NOW(),
        decision_note = p_decision_note
    WHERE id = p_approval_id;
    v_audit_action := 'APPROVAL_REJECT';
  END IF;

  -- Audit log with canonical action name
  INSERT INTO audit_logs (
    user_id, user_name, user_role, cashier_id, branch_id, shift_id,
    action, entity, entity_id, reason, details
  ) VALUES (
    p_reviewer_id, p_reviewer_name, p_reviewer_role,
    v_req.requested_by, v_req.branch_id, v_req.shift_id,
    v_audit_action, 'ApprovalRequest', p_approval_id::TEXT,
    p_decision_note,
    jsonb_build_object(
      'decision', p_decision,
      'operation_type', v_req.operation_type,
      'requested_amount', v_req.requested_amount,
      'requested_by', v_req.requested_by,
      'requester_name', v_req.requester_name
    )::TEXT
  );

  RETURN jsonb_build_object(
    'success', true,
    'approval_id', p_approval_id,
    'status', p_decision,
    'reviewer_id', p_reviewer_id,
    'reviewed_at', NOW()
  );
END;
$$;

-- 5. ATOMIC APPROVAL CONSUMPTION (ONE APPROVAL -> ONE TRANSACTION)
CREATE OR REPLACE FUNCTION fn_consume_approval_request(
  p_approval_id UUID,
  p_cashier_id VARCHAR,
  p_branch_id UUID,
  p_shift_id UUID,
  p_operation_type VARCHAR,
  p_applied_amount NUMERIC,
  p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
BEGIN
  SELECT * INTO v_req
  FROM approval_requests
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_APPROVAL_NOT_FOUND: Approval request % does not exist', p_approval_id;
  END IF;

  IF v_req.status = 'consumed' THEN
    RAISE EXCEPTION 'ERR_APPROVAL_ALREADY_CONSUMED: Approval request % has already been consumed', p_approval_id;
  END IF;

  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'ERR_APPROVAL_NOT_APPROVED: Approval request status is %, expected approved', v_req.status;
  END IF;

  IF v_req.expires_at < NOW() THEN
    UPDATE approval_requests SET status = 'expired' WHERE id = p_approval_id;
    RAISE EXCEPTION 'ERR_APPROVAL_EXPIRED: Approval request has expired';
  END IF;

  IF v_req.requested_by <> p_cashier_id THEN
    RAISE EXCEPTION 'ERR_APPROVAL_CASHIER_MISMATCH: Approval requested by %, attempted consumption by %', v_req.requested_by, p_cashier_id;
  END IF;

  IF v_req.branch_id <> p_branch_id THEN
    RAISE EXCEPTION 'ERR_APPROVAL_BRANCH_MISMATCH: Approval bound to branch %, not %', v_req.branch_id, p_branch_id;
  END IF;

  IF p_shift_id IS NOT NULL AND v_req.shift_id IS NOT NULL AND v_req.shift_id <> p_shift_id THEN
    RAISE EXCEPTION 'ERR_APPROVAL_SHIFT_MISMATCH: Approval bound to shift %, not %', v_req.shift_id, p_shift_id;
  END IF;

  IF v_req.operation_type <> p_operation_type THEN
    RAISE EXCEPTION 'ERR_APPROVAL_OPERATION_MISMATCH: Approval is for %, not %', v_req.operation_type, p_operation_type;
  END IF;

  IF v_req.requested_amount < p_applied_amount THEN
    RAISE EXCEPTION 'ERR_APPROVAL_AMOUNT_EXCEEDED: Approved amount % is less than applied %', v_req.requested_amount, p_applied_amount;
  END IF;

  -- CRITICAL: Prevent consumption if self-approved
  IF v_req.requested_by = v_req.approved_by THEN
    RAISE EXCEPTION 'ERR_SELF_APPROVAL: Self-approved requests cannot be consumed';
  END IF;

  UPDATE approval_requests
  SET status = 'consumed',
      consumed_at = NOW(),
      consumed_by_order_id = p_order_id
  WHERE id = p_approval_id;

  -- Audit entry for consumption
  INSERT INTO audit_logs (
    user_id, user_name, user_role, cashier_id, branch_id, shift_id,
    action, entity, entity_id, reason, financial_impact, details
  ) VALUES (
    p_cashier_id, COALESCE(v_req.requester_name, 'Cashier'), v_req.requester_role,
    p_cashier_id, p_branch_id, p_shift_id,
    'APPROVAL_CONSUME', 'ApprovalRequest', p_approval_id::TEXT,
    'Consumed approval for order transaction', p_applied_amount,
    jsonb_build_object(
      'order_id', p_order_id,
      'operation_type', v_req.operation_type,
      'approved_by', v_req.approved_by,
      'applied_amount', p_applied_amount
    )::TEXT
  );

  RETURN jsonb_build_object(
    'success', true,
    'approval_id', p_approval_id,
    'status', 'consumed',
    'consumed_at', NOW(),
    'order_id', p_order_id
  );
END;
$$;

-- 6. ATOMIC RISK EVENT REVIEW RPC WITH BRANCH ISOLATION & CONTROLLED TRANSITIONS
CREATE OR REPLACE FUNCTION fn_review_risk_event(
  p_event_id UUID,
  p_reviewer_id VARCHAR,
  p_reviewer_name VARCHAR,
  p_reviewer_role VARCHAR,
  p_new_status VARCHAR,
  p_resolution_note TEXT DEFAULT NULL,
  p_reviewer_branch_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_action VARCHAR(50);
BEGIN
  IF p_reviewer_role NOT IN ('owner', 'admin', 'store_manager', 'manager') THEN
    RAISE EXCEPTION 'ERR_UNAUTHORIZED_REVIEWER: Only managers, store managers, admins, and owners can review risk events';
  END IF;

  IF p_new_status NOT IN ('acknowledged', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'ERR_INVALID_STATUS: Status must be acknowledged, resolved, or dismissed';
  END IF;

  SELECT * INTO v_event
  FROM risk_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_RISK_EVENT_NOT_FOUND: Risk event % not found', p_event_id;
  END IF;

  -- Branch isolation
  IF p_reviewer_role NOT IN ('owner', 'admin') AND (p_reviewer_branch_id IS NULL OR v_event.branch_id <> p_reviewer_branch_id) THEN
    RAISE EXCEPTION 'ERR_BRANCH_ACCESS_DENIED: Manager cannot review risk events from another branch';
  END IF;

  -- Controlled state transitions: terminal states cannot be changed
  IF v_event.status IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'ERR_INVALID_TRANSITION: Cannot modify risk event with terminal status %', v_event.status;
  END IF;

  IF v_event.status = 'acknowledged' AND p_new_status = 'acknowledged' THEN
    RAISE EXCEPTION 'ERR_INVALID_TRANSITION: Risk event is already acknowledged';
  END IF;

  UPDATE risk_events
  SET status = p_new_status,
      reviewed_by = p_reviewer_id,
      reviewed_by_name = p_reviewer_name,
      reviewed_at = NOW(),
      resolution_note = p_resolution_note
  WHERE id = p_event_id;

  IF p_new_status = 'acknowledged' THEN
    v_action := 'RISK_EVENT_ACKNOWLEDGE';
  ELSIF p_new_status = 'resolved' THEN
    v_action := 'RISK_EVENT_RESOLVE';
  ELSE
    v_action := 'RISK_EVENT_DISMISS';
  END IF;

  INSERT INTO audit_logs (
    user_id, user_name, user_role, cashier_id, branch_id, shift_id,
    action, entity, entity_id, reason, details
  ) VALUES (
    p_reviewer_id, p_reviewer_name, p_reviewer_role,
    v_event.cashier_id, v_event.branch_id, v_event.shift_id,
    v_action, 'RiskEvent', p_event_id::TEXT,
    p_resolution_note,
    jsonb_build_object(
      'previous_status', v_event.status,
      'new_status', p_new_status,
      'event_type', v_event.event_type,
      'severity', v_event.severity,
      'cashier_id', v_event.cashier_id
    )::TEXT
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'status', p_new_status,
    'reviewed_by', p_reviewer_id,
    'reviewed_at', NOW()
  );
END;
$$;

-- 7. UPDATE fn_record_cash_drawer_movement TO RETURN movement_id
CREATE OR REPLACE FUNCTION fn_record_cash_drawer_movement(
  p_shift_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID,
  p_type TEXT,
  p_amount NUMERIC,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shift cash_drawer_shifts;
  v_movement_id UUID;
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
  VALUES(p_shift_id,p_branch_id,p_cashier_id,p_type,p_amount,COALESCE(NULLIF(TRIM(p_reason),''),'Cash drawer movement'))
  RETURNING id INTO v_movement_id;

  UPDATE cash_drawer_shifts
  SET expected_cash = expected_cash + CASE WHEN p_type='cash_in' THEN p_amount ELSE -p_amount END,
      updated_at=NOW()
  WHERE id=p_shift_id;

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'movement_id', v_movement_id,
    'expected_cash', (SELECT expected_cash FROM cash_drawer_shifts WHERE id=p_shift_id)
  );
END;
$$;
