CREATE OR REPLACE FUNCTION public.fn_financial_settlement_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_paid_total NUMERIC(12,2) := 0;
  v_is_pos BOOLEAN := false;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_FINANCIAL_ORDER_NOT_FOUND: Order % does not exist', NEW.order_id;
  END IF;

  IF NEW.status <> 'paid' THEN
    RETURN NEW;
  END IF;

  v_is_pos := v_order.source IN ('pos_cashier', 'pos_store');

  SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2)
  INTO v_paid_total
  FROM public.payments
  WHERE order_id = NEW.order_id
    AND status = 'paid';

  UPDATE public.orders
  SET payment_status = CASE
    WHEN ROUND(v_paid_total * 100) >= ROUND(v_order.total * 100) THEN 'paid'::payment_status_enum
    WHEN v_paid_total > 0 THEN 'partially_paid'::payment_status_enum
    ELSE 'pending'::payment_status_enum
  END,
  updated_at = NOW()
  WHERE id = NEW.order_id;

  IF v_is_pos THEN
    PERFORM public.fn_post_pos_payment_to_financial_ledger(NEW.id);
  ELSE
    PERFORM public.fn_post_order_sale_to_financial_ledger(NEW.order_id);
  END IF;

  RETURN NEW;
END;
$function$;
