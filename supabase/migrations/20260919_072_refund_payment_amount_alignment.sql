-- 20260919_072_refund_payment_amount_alignment
DO $migration$
DECLARE
  v_sql TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='fn_atomic_pos_refund'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_order_id uuid, p_branch_id uuid, p_cashier_id uuid, p_shift_id uuid, p_reason text';

  IF v_sql IS NULL THEN
    RAISE EXCEPTION 'ERR_MIGRATION_SOURCE_FUNCTION_MISSING: fn_atomic_pos_refund';
  END IF;

  IF position('v_payment.paid_amount' IN v_sql) = 0 THEN
    RAISE EXCEPTION 'ERR_MIGRATION_EXPECTED_PAID_AMOUNT_REFERENCE_NOT_FOUND';
  END IF;

  v_sql := replace(v_sql, 'COALESCE(v_payment.paid_amount, v_payment.amount, 0)', 'COALESCE(v_payment.amount, 0)');
  EXECUTE v_sql;
END
$migration$;
