-- ==============================================================================
-- BO'SH STORE — SECURITY DEFINER EXECUTION SURFACE HARDENING
-- Migration: 20260919_056_security_definer_execution_surface_hardening
-- Purpose:
--   1. Pin mutable search_path settings on existing SECURITY DEFINER functions.
--   2. Remove Data API execution access from internal SECURITY DEFINER/trigger functions.
--   3. Keep explicit service_role execution only for server-side RPC entrypoints.
-- ==============================================================================

ALTER FUNCTION public.touch_branch_inventory_stock_updated_at()
  SET search_path = public;

ALTER FUNCTION public.trg_audit_logs_immutable()
  SET search_path = public;

ALTER FUNCTION public.fn_financial_transactions_append_only()
  SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.enforce_gaming_station_branch()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_staff_access_scope()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_financial_order_status_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_financial_pos_shift_binding_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_financial_settlement_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_lock_pos_shift_for_payment()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_lock_shift_for_cash_movement()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_lock_shift_for_refund_settlement()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_validate_payment_settlement()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_gaming_reservation_branch()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_gaming_session_branch()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_inventory_movement_branch()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_order_branch_from_audit()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_serialized_device_branch()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_order_inventory_branch()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_record_receipt_reprint(
  UUID, UUID, VARCHAR, VARCHAR, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_receipt_reprint(
  UUID, UUID, VARCHAR, VARCHAR, UUID, TEXT
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_review_approval_request(
  UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_review_approval_request(
  UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_review_approval_request(
  UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_review_approval_request(
  UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, UUID
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_review_risk_event(
  UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_review_risk_event(
  UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, UUID
) TO service_role;
