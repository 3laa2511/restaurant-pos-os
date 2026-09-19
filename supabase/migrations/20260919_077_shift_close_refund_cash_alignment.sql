-- 20260919_077_shift_close_refund_cash_alignment
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

  IF position('m.type=''refund_cash''' IN v_sql) = 0 THEN
    v_sql := replace(
      v_sql,
      '    + COALESCE((SELECT SUM(CASE WHEN m.type=''cash_in'' THEN m.amount WHEN m.type=''cash_out'' THEN -m.amount ELSE 0 END)',
      '    + COALESCE((SELECT SUM(CASE WHEN m.type=''cash_in'' THEN m.amount WHEN m.type=''cash_out'' THEN -m.amount WHEN m.type=''refund_cash'' THEN -m.amount ELSE 0 END)'
    );
  END IF;

  IF position('m.type=''refund_cash''' IN v_sql) = 0 THEN
    RAISE EXCEPTION 'ERR_MIGRATION_REFUND_CASH_ALIGNMENT_FAILED';
  END IF;

  EXECUTE v_sql;
END
$migration$;
