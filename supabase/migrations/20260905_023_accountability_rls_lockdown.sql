-- ==============================================================================
-- BO'SH STORE — ACCOUNTABILITY RLS LOCKDOWN
-- Migration: 20260905_023_accountability_rls_lockdown
-- Purpose: Keep sensitive anti-theft/accountability records server-only.
-- Browser clients must use the authenticated API, which enforces branch/RBAC.
-- ==============================================================================

-- These tables contain cashier behavior, approvals, risk evidence and receipt
-- history. Direct authenticated SELECT/INSERT would bypass the server's branch
-- and separation-of-duties controls, so they are intentionally service-role only.

ALTER TABLE risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_receipt_reprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view risk events" ON risk_events;
DROP POLICY IF EXISTS "Authenticated users can create approval requests" ON approval_requests;
DROP POLICY IF EXISTS "Authenticated users can view approval requests" ON approval_requests;
DROP POLICY IF EXISTS "Authenticated users can view receipt reprints" ON order_receipt_reprints;
DROP POLICY IF EXISTS "Authenticated users can create receipt reprints" ON order_receipt_reprints;

REVOKE ALL ON TABLE risk_events FROM anon, authenticated;
REVOKE ALL ON TABLE approval_requests FROM anon, authenticated;
REVOKE ALL ON TABLE order_receipt_reprints FROM anon, authenticated;

GRANT ALL ON TABLE risk_events TO service_role;
GRANT ALL ON TABLE approval_requests TO service_role;
GRANT ALL ON TABLE order_receipt_reprints TO service_role;

COMMENT ON TABLE risk_events IS
  'Sensitive cashier risk telemetry. Server/API only; branch and RBAC checks are enforced above the database boundary.';
COMMENT ON TABLE approval_requests IS
  'Sensitive manager approval workflow. Server/API only; separation of duties and branch isolation are enforced by authoritative RPCs.';
COMMENT ON TABLE order_receipt_reprints IS
  'Sensitive receipt reprint accountability ledger. Server/API only.';
