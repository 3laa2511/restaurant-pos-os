CREATE OR REPLACE FUNCTION public.fn_atomic_pos_checkout_base(p_order_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  v_shift_id UUID; v_branch_id UUID; v_cashier_id UUID; v_order_result JSONB; v_order_id UUID;
  v_existing_source TEXT; v_payment_shift_id UUID; v_cash_paid NUMERIC(12,2); v_payment_count INT;
BEGIN
  IF COALESCE(NULLIF(p_order_payload->>'source',''),'') NOT IN ('pos_cashier','pos_store') THEN
    RAISE EXCEPTION 'ERR_POS_SOURCE_REQUIRED: POS checkout source is required';
  END IF;
  BEGIN
    v_branch_id:=NULLIF(p_order_payload->>'branch_id','')::UUID;
    v_cashier_id:=NULLIF(p_order_payload->>'cashier_id','')::UUID;
    v_shift_id:=NULLIF(p_order_payload->>'shift_id','')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ERR_INVALID_SHIFT_CONTEXT: branch, cashier and shift IDs must be valid UUIDs';
  END;
  IF v_branch_id IS NULL OR v_cashier_id IS NULL OR v_shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_SHIFT_REQUIRED: An open cash drawer shift is required for POS checkout';
  END IF;

  SELECT o.id,o.source,p.shift_id INTO v_order_id,v_existing_source,v_payment_shift_id
  FROM orders o LEFT JOIN payments p ON p.order_id=o.id
  WHERE o.order_number=NULLIF(TRIM(p_order_payload->>'order_number'),'')
  ORDER BY p.created_at DESC NULLS LAST LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    IF v_existing_source NOT IN ('pos_cashier','pos_store') THEN RAISE EXCEPTION 'ERR_ORDER_NUMBER_CONFLICT: Order number already belongs to a non-POS order'; END IF;
    IF v_payment_shift_id IS NULL THEN RAISE EXCEPTION 'ERR_SHIFT_BINDING_MISSING: Existing POS payment is missing its cash drawer shift binding'; END IF;
    IF v_payment_shift_id<>v_shift_id THEN RAISE EXCEPTION 'ERR_SHIFT_BINDING_CONFLICT: Existing POS order is bound to a different cash drawer shift'; END IF;
    RETURN fn_atomic_checkout(p_order_payload);
  END IF;

  PERFORM 1 FROM cash_drawer_shifts
  WHERE id=v_shift_id AND branch_id=v_branch_id AND cashier_id=v_cashier_id AND status='open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_SHIFT_REQUIRED: No open cash drawer shift belongs to this cashier and branch'; END IF;

  v_order_result:=fn_atomic_checkout(p_order_payload);
  v_order_id:=NULLIF(v_order_result->>'order_id','')::UUID;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'ERR_ATOMIC_CHECKOUT_FAILED: Atomic checkout did not return an order ID'; END IF;

  SELECT count(*),max(shift_id) INTO v_payment_count,v_payment_shift_id FROM payments WHERE order_id=v_order_id;
  IF v_payment_count=0 THEN RAISE EXCEPTION 'ERR_SHIFT_PAYMENT_BINDING_FAILED: POS checkout created no payment'; END IF;
  IF v_payment_count<>1 THEN RAISE EXCEPTION 'ERR_SHIFT_PAYMENT_BINDING_FAILED: POS checkout created an unexpected number of payments'; END IF;
  IF v_payment_shift_id IS NULL THEN
    UPDATE payments SET shift_id=v_shift_id WHERE order_id=v_order_id AND shift_id IS NULL;
  ELSIF v_payment_shift_id<>v_shift_id THEN
    RAISE EXCEPTION 'ERR_SHIFT_PAYMENT_BINDING_FAILED: POS payment is bound to a different cash drawer shift';
  END IF;

  SELECT COALESCE(cash_amount,0) INTO v_cash_paid FROM payments WHERE order_id=v_order_id LIMIT 1;
  IF v_cash_paid>0 THEN
    UPDATE cash_drawer_shifts SET expected_cash=ROUND(expected_cash+v_cash_paid,2),updated_at=NOW() WHERE id=v_shift_id;
  END IF;

  RETURN v_order_result||jsonb_build_object('shift_id',v_shift_id);
END;
$function$;