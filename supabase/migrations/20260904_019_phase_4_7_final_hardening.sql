-- ==============================================================================
-- BO'SH STORE — PHASE 4.7 FINAL HARDENING
-- Migration: 20260904_019_phase_4_7_final_hardening
-- Purpose:
--   1. Bind approvals to the exact authoritative order entity.
--   2. Consume discount approvals inside the same PostgreSQL transaction as POS checkout.
--   3. Make authoritative DB subtotal/discount the source of approval policy decisions.
--   4. Preserve idempotent POS retries when the same approval was already consumed.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_consume_approval_request(
  p_approval_id UUID,
  p_cashier_id VARCHAR,
  p_branch_id UUID,
  p_shift_id UUID,
  p_operation_type VARCHAR,
  p_applied_amount NUMERIC,
  p_order_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req RECORD; v_order RECORD;
BEGIN
  IF p_approval_id IS NULL OR p_order_id IS NULL THEN RAISE EXCEPTION 'ERR_APPROVAL_CONTEXT_REQUIRED: Approval and order are required'; END IF;
  IF p_applied_amount IS NULL OR p_applied_amount::TEXT IN ('NaN','Infinity','-Infinity') OR p_applied_amount < 0 THEN
    RAISE EXCEPTION 'ERR_APPROVAL_AMOUNT_INVALID: Applied approval amount must be finite and non-negative';
  END IF;
  SELECT * INTO v_req FROM approval_requests WHERE id=p_approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_APPROVAL_NOT_FOUND: Approval request % does not exist',p_approval_id; END IF;
  IF v_req.status='consumed' THEN
    IF v_req.consumed_by_order_id=p_order_id THEN RETURN jsonb_build_object('success',true,'approval_id',p_approval_id,'status','consumed','already_consumed',true,'order_id',p_order_id); END IF;
    RAISE EXCEPTION 'ERR_APPROVAL_ALREADY_CONSUMED: Approval request has already been consumed by another order';
  END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'ERR_APPROVAL_NOT_APPROVED: Approval request status is %, expected approved',v_req.status; END IF;
  IF v_req.expires_at IS NOT NULL AND v_req.expires_at <= NOW() THEN UPDATE approval_requests SET status='expired' WHERE id=p_approval_id; RAISE EXCEPTION 'ERR_APPROVAL_EXPIRED: Approval request has expired'; END IF;
  IF v_req.requested_by <> p_cashier_id THEN RAISE EXCEPTION 'ERR_APPROVAL_CASHIER_MISMATCH: Approval belongs to another cashier'; END IF;
  IF v_req.branch_id <> p_branch_id THEN RAISE EXCEPTION 'ERR_APPROVAL_BRANCH_MISMATCH: Approval belongs to another branch'; END IF;
  IF v_req.shift_id IS NOT NULL AND v_req.shift_id <> p_shift_id THEN RAISE EXCEPTION 'ERR_APPROVAL_SHIFT_MISMATCH: Approval belongs to another shift'; END IF;
  IF v_req.operation_type <> p_operation_type THEN RAISE EXCEPTION 'ERR_APPROVAL_OPERATION_MISMATCH: Approval is for %, not %',v_req.operation_type,p_operation_type; END IF;
  IF COALESCE(v_req.entity_type,'') <> 'Order' OR v_req.entity_id IS NULL OR v_req.entity_id::TEXT <> p_order_id::TEXT THEN RAISE EXCEPTION 'ERR_APPROVAL_ENTITY_MISMATCH: Approval is not bound to this order'; END IF;
  IF COALESCE(v_req.requested_amount,0) < p_applied_amount THEN RAISE EXCEPTION 'ERR_APPROVAL_AMOUNT_EXCEEDED: Approved amount % is less than applied %',v_req.requested_amount,p_applied_amount; END IF;
  IF v_req.requested_by=v_req.approved_by THEN RAISE EXCEPTION 'ERR_SELF_APPROVAL: Self-approved requests cannot be consumed'; END IF;
  SELECT id,branch_id,cashier_id,shift_id,source,subtotal,discount,total INTO v_order FROM orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_APPROVAL_ORDER_NOT_FOUND: Order does not exist'; END IF;
  IF v_order.branch_id<>p_branch_id OR v_order.cashier_id::TEXT<>p_cashier_id OR v_order.shift_id<>p_shift_id OR v_order.source NOT IN ('pos_cashier','pos_store') THEN RAISE EXCEPTION 'ERR_APPROVAL_TRANSACTION_CONTEXT_MISMATCH: Approval does not match the authoritative POS transaction context'; END IF;
  UPDATE approval_requests SET status='consumed',consumed_at=NOW(),consumed_by_order_id=p_order_id WHERE id=p_approval_id AND status='approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_APPROVAL_CONSUME_RACE: Approval could not be consumed'; END IF;
  INSERT INTO audit_logs(user_id,user_name,user_role,cashier_id,branch_id,shift_id,action,entity,entity_id,reason,financial_impact,details)
  VALUES(p_cashier_id,COALESCE(v_req.requester_name,'Cashier'),COALESCE(v_req.requester_role,'cashier'),p_cashier_id,p_branch_id,p_shift_id,'APPROVAL_CONSUME','ApprovalRequest',p_approval_id::TEXT,'Consumed approval for authoritative POS order',p_applied_amount,jsonb_build_object('order_id',p_order_id,'operation_type',v_req.operation_type,'approved_by',v_req.approved_by,'applied_amount',p_applied_amount)::TEXT);
  RETURN jsonb_build_object('success',true,'approval_id',p_approval_id,'status','consumed','consumed_at',NOW(),'order_id',p_order_id);
END; $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_atomic_pos_checkout' AND pg_get_function_identity_arguments(p.oid)='p_order_payload jsonb')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_atomic_pos_checkout_base' AND pg_get_function_identity_arguments(p.oid)='p_order_payload jsonb') THEN
    ALTER FUNCTION public.fn_atomic_pos_checkout(JSONB) RENAME TO fn_atomic_pos_checkout_base;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_atomic_pos_checkout(p_order_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order_result JSONB; v_order_id UUID; v_order RECORD; v_approval_id UUID; v_discount NUMERIC(12,2); v_subtotal NUMERIC(12,2); v_discount_percent NUMERIC(12,4); v_cashier_id UUID; v_branch_id UUID; v_shift_id UUID; v_cashier_role TEXT; v_is_manager BOOLEAN;
BEGIN
  v_order_result:=fn_atomic_pos_checkout_base(p_order_payload); v_order_id:=NULLIF(v_order_result->>'order_id','')::UUID;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'ERR_ATOMIC_CHECKOUT_FAILED: POS checkout did not return an order ID'; END IF;
  SELECT o.id,o.branch_id,o.cashier_id,o.shift_id,o.source,ROUND(COALESCE(o.subtotal,0),2),ROUND(COALESCE(o.discount,0),2),o.total INTO v_order FROM orders o WHERE o.id=v_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_ATOMIC_CHECKOUT_FAILED: Created POS order could not be reloaded'; END IF;
  v_branch_id:=v_order.branch_id; v_cashier_id:=v_order.cashier_id::UUID; v_shift_id:=v_order.shift_id; v_cashier_role:=COALESCE(NULLIF(p_order_payload->>'cashier_role',''),'cashier'); v_is_manager:=v_cashier_role IN ('owner','admin','store_manager','manager'); v_subtotal:=v_order.subtotal; v_discount:=v_order.discount;
  IF v_discount<0 OR v_discount>v_subtotal THEN RAISE EXCEPTION 'ERR_INVALID_DISCOUNT: Discount must be non-negative and cannot exceed authoritative subtotal'; END IF;
  v_discount_percent:=CASE WHEN v_subtotal>0 THEN (v_discount/v_subtotal)*100 ELSE 0 END;
  BEGIN v_approval_id:=NULLIF(p_order_payload->>'approval_request_id','')::UUID; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'ERR_APPROVAL_ID_INVALID: Approval request ID must be a valid UUID'; END;
  IF v_discount>0 AND NOT v_is_manager AND (v_discount_percent>10 OR v_discount>200) AND v_approval_id IS NULL THEN RAISE EXCEPTION 'ERR_MANAGER_APPROVAL_REQUIRED: Discount exceeds cashier approval threshold'; END IF;
  IF v_approval_id IS NOT NULL THEN PERFORM fn_consume_approval_request(v_approval_id,v_cashier_id::VARCHAR,v_branch_id,v_shift_id,'DISCOUNT_APPLY',v_discount,v_order_id); END IF;
  RETURN v_order_result || jsonb_build_object('approval_consumed',v_approval_id IS NOT NULL,'authoritative_subtotal',v_subtotal,'authoritative_discount',v_discount,'authoritative_discount_percent',ROUND(v_discount_percent,2));
END; $$;

REVOKE ALL ON FUNCTION fn_atomic_pos_checkout(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_pos_checkout(JSONB) FROM anon,authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_checkout(JSONB) TO service_role;
REVOKE ALL ON FUNCTION fn_atomic_pos_checkout_base(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_pos_checkout_base(JSONB) FROM anon,authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_checkout_base(JSONB) TO service_role;
REVOKE ALL ON FUNCTION fn_consume_approval_request(UUID,VARCHAR,UUID,UUID,VARCHAR,NUMERIC,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_consume_approval_request(UUID,VARCHAR,UUID,UUID,VARCHAR,NUMERIC,UUID) FROM anon,authenticated;
GRANT EXECUTE ON FUNCTION fn_consume_approval_request(UUID,VARCHAR,UUID,UUID,VARCHAR,NUMERIC,UUID) TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_atomic_pos_checkout' AND pg_get_function_identity_arguments(p.oid)='p_order_payload jsonb') THEN RAISE EXCEPTION 'ERR_MIGRATION_019: fn_atomic_pos_checkout was not installed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_atomic_pos_checkout_base' AND pg_get_function_identity_arguments(p.oid)='p_order_payload jsonb') THEN RAISE EXCEPTION 'ERR_MIGRATION_019: previous atomic POS checkout implementation was not preserved'; END IF;
END $$;
