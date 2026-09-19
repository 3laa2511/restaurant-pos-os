-- ==============================================================================
-- BO'SH STORE — PHASE 4.7: CASHIER ACCOUNTABILITY & ANTI-THEFT CONTROL LAYER
-- Migration: 20260904_017_cashier_accountability_anti_theft
-- Purpose: Canonical operation taxonomy, immutable structured audit logging,
--          anti-theft risk engine tables, receipt reprint tracking, and
--          manager approval workflows with strict separation of duties.
-- ==============================================================================

-- 1. EXTEND AUDIT_LOGS TABLE WITH ACCOUNTABILITY COLUMNS
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS cashier_id VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS shift_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS terminal_id VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS financial_impact NUMERIC(12,2) DEFAULT 0;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS idx_audit_logs_branch ON audit_logs(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_shift ON audit_logs(shift_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_cashier ON audit_logs(cashier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);

-- 2. AUDIT LOG IMMUTABILITY TRIGGER (APPEND-ONLY GUARANTEE)
CREATE OR REPLACE FUNCTION trg_audit_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ERR_AUDIT_LOG_IMMUTABLE: Audit logs are append-only and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_audit_logs ON audit_logs;
CREATE TRIGGER trg_protect_audit_logs
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION trg_audit_logs_immutable();

-- Restrict permissions: authenticated cannot update or delete
REVOKE UPDATE, DELETE ON audit_logs FROM anon, authenticated;

-- 3. RISK EVENTS TABLE
CREATE TABLE IF NOT EXISTS risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  cashier_id VARCHAR(100) NOT NULL,
  cashier_name VARCHAR(255) NOT NULL,
  shift_id UUID,
  event_type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  risk_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  amount NUMERIC(12,2) DEFAULT 0,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  reviewed_by VARCHAR(100),
  reviewed_by_name VARCHAR(255),
  reviewed_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_events_branch ON risk_events(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_cashier ON risk_events(cashier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_shift ON risk_events(shift_id);
CREATE INDEX IF NOT EXISTS idx_risk_events_status ON risk_events(status);
CREATE INDEX IF NOT EXISTS idx_risk_events_severity ON risk_events(severity);
CREATE INDEX IF NOT EXISTS idx_risk_events_created ON risk_events(created_at DESC);

ALTER TABLE risk_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE risk_events FROM anon;
GRANT SELECT ON TABLE risk_events TO authenticated;
GRANT ALL ON TABLE risk_events TO service_role;

-- 4. MANAGER APPROVAL REQUESTS TABLE
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  shift_id UUID,
  requested_by VARCHAR(100) NOT NULL,
  requester_name VARCHAR(255) NOT NULL,
  requester_role VARCHAR(50) NOT NULL,
  operation_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100),
  requested_amount NUMERIC(12,2) DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  approved_by VARCHAR(100),
  approver_name VARCHAR(255),
  approved_at TIMESTAMPTZ,
  rejected_by VARCHAR(100),
  rejecter_name VARCHAR(255),
  rejected_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_branch ON approval_requests(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requester ON approval_requests(requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE approval_requests FROM anon;
GRANT SELECT, INSERT ON TABLE approval_requests TO authenticated;
GRANT ALL ON TABLE approval_requests TO service_role;

-- 5. RECEIPT REPRINT TRACKING TABLE
CREATE TABLE IF NOT EXISTS order_receipt_reprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL,
  cashier_id VARCHAR(100) NOT NULL,
  cashier_name VARCHAR(255) NOT NULL,
  shift_id UUID,
  reason TEXT NOT NULL,
  reprint_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reprints_order ON order_receipt_reprints(order_id);
CREATE INDEX IF NOT EXISTS idx_reprints_cashier ON order_receipt_reprints(cashier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reprints_branch ON order_receipt_reprints(branch_id, created_at DESC);

ALTER TABLE order_receipt_reprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE order_receipt_reprints FROM anon;
GRANT SELECT, INSERT ON TABLE order_receipt_reprints TO authenticated;
GRANT ALL ON TABLE order_receipt_reprints TO service_role;

-- 6. ATOMIC RECEIPT REPRINT FUNCTION
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
  -- 1. Validate order exists and belongs to branch
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
    AND branch_id = p_branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ORDER_NOT_FOUND: Order does not exist or does not belong to this branch';
  END IF;

  -- 2. Count existing reprints for this order
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

  -- 4. Record audit log entry
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

-- 7. ATOMIC MANAGER APPROVAL DECISION FUNCTION
CREATE OR REPLACE FUNCTION fn_review_approval_request(
  p_approval_id UUID,
  p_reviewer_id VARCHAR,
  p_reviewer_name VARCHAR,
  p_reviewer_role VARCHAR,
  p_decision VARCHAR, -- 'approved' or 'rejected'
  p_decision_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
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
  ELSE
    UPDATE approval_requests
    SET status = 'rejected',
        rejected_by = p_reviewer_id,
        rejecter_name = p_reviewer_name,
        rejected_at = NOW(),
        decision_note = p_decision_note
    WHERE id = p_approval_id;
  END IF;

  -- Audit log for the decision
  INSERT INTO audit_logs (
    user_id, user_name, user_role, cashier_id, branch_id, shift_id,
    action, entity, entity_id, reason, details
  ) VALUES (
    p_reviewer_id, p_reviewer_name, p_reviewer_role,
    v_req.requested_by, v_req.branch_id, v_req.shift_id,
    'MANAGER_APPROVAL', 'ApprovalRequest', p_approval_id::TEXT,
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
