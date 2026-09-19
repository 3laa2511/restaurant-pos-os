-- 20260919_078_shift_close_cash_net_alignment
DO $migration$
DECLARE
  v_sql TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='fn_close_cash_drawer_shift'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_shift_id uuid, p_branch_id uuid, p_cashier_id uuid, p_actual_cash numeric, p_note text';

  IF v_sql IS NULL THEN
    RAISE EXCEPTION 'ERR_MIGRATION_SOURCE_FUNCTION_MISSING: fn_close_cash_drawer_shift';
  END IF;

  IF position('SUM(p.change_amount)' IN v_sql) = 0 THEN
    RAISE EXCEPTION 'ERR_MIGRATION_EXPECTED_CHANGE_SUBTRACTION_NOT_FOUND';
  END IF;

  v_sql := replace(
    v_sql,
    '    - COALESCE((SELECT SUM(p.change_amount)
               FROM payments p JOIN orders o ON o.id=p.order_id
               WHERE p.status=''paid'' AND p.change_amount>0
                 AND o.source IN (''pos_cashier'',''pos_store'')
                 AND p.created_at >= v_shift.opened_at
                 AND o.created_at >= v_shift.opened_at),0)',
    ''
  );
  EXECUTE v_sql;
END
$migration$;
