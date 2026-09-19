CREATE OR REPLACE FUNCTION public.fn_atomic_pos_checkout(p_order_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  v_order_result JSONB; v_order_id UUID; v_order RECORD; v_approval_id UUID;
  v_discount NUMERIC(12,2); v_subtotal NUMERIC(12,2); v_discount_percent NUMERIC(12,4);
  v_cashier_id UUID; v_branch_id UUID; v_shift_id UUID; v_cashier_role TEXT; v_is_manager BOOLEAN;
BEGIN
  v_order_result:=fn_atomic_pos_checkout_base(p_order_payload);
  v_order_id:=NULLIF(v_order_result->>'order_id','')::UUID;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'ERR_ATOMIC_CHECKOUT_FAILED: POS checkout did not return an order ID'; END IF;

  SELECT o.id AS id,o.branch_id AS branch_id,o.cashier_id AS cashier_id,o.shift_id AS shift_id,o.source AS source,
         ROUND(COALESCE(o.subtotal,0),2) AS subtotal,ROUND(COALESCE(o.discount,0),2) AS discount,
         ROUND(COALESCE(o.total,0),2) AS total
  INTO v_order FROM orders o WHERE o.id=v_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_ATOMIC_CHECKOUT_FAILED: Created POS order could not be reloaded'; END IF;

  v_branch_id:=v_order.branch_id; v_cashier_id:=v_order.cashier_id::UUID; v_shift_id:=v_order.shift_id;
  v_cashier_role:=COALESCE(NULLIF(p_order_payload->>'cashier_role',''),'cashier');
  v_is_manager:=v_cashier_role IN ('owner','admin','store_manager','manager');
  v_subtotal:=v_order.subtotal; v_discount:=v_order.discount;

  IF v_discount<0 OR v_discount>v_subtotal THEN RAISE EXCEPTION 'ERR_INVALID_DISCOUNT: Discount must be non-negative and cannot exceed authoritative subtotal'; END IF;
  v_discount_percent:=CASE WHEN v_subtotal>0 THEN (v_discount/v_subtotal)*100 ELSE 0 END;

  BEGIN v_approval_id:=NULLIF(p_order_payload->>'approval_request_id','')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'ERR_APPROVAL_ID_INVALID: Approval request ID must be a valid UUID'; END;

  IF v_discount>0 AND NOT v_is_manager AND (v_discount_percent>10 OR v_discount>200) AND v_approval_id IS NULL THEN
    RAISE EXCEPTION 'ERR_MANAGER_APPROVAL_REQUIRED: Discount exceeds cashier approval threshold';
  END IF;
  IF v_approval_id IS NOT NULL THEN
    PERFORM fn_consume_approval_request(v_approval_id,v_cashier_id::VARCHAR,v_branch_id,v_shift_id,'DISCOUNT_APPLY',v_discount,v_order_id);
  END IF;

  RETURN v_order_result||jsonb_build_object('approval_consumed',v_approval_id IS NOT NULL,
    'authoritative_subtotal',v_subtotal,'authoritative_discount',v_discount,'authoritative_discount_percent',ROUND(v_discount_percent,2));
END;
$function$;