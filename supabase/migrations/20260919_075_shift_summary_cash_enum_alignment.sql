-- 20260919_075_shift_summary_cash_enum_alignment
DO $migration$
DECLARE
  v_sql TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='fn_get_cashier_shift_summary'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_shift_id uuid, p_branch_id uuid, p_cashier_id uuid';

  IF v_sql IS NULL THEN
    RAISE EXCEPTION 'ERR_MIGRATION_SOURCE_FUNCTION_MISSING: fn_get_cashier_shift_summary';
  END IF;

  IF position('p.method = ''cash''' IN v_sql) = 0 THEN
    RAISE EXCEPTION 'ERR_MIGRATION_EXPECTED_CASH_ENUM_REFERENCE_NOT_FOUND';
  END IF;

  v_sql := replace(
    v_sql,
    'p.method = ''pos_cash'' OR (p.method = ''cash'' AND p.cash_amount > 0)',
    'p.method = ''pos_cash'''
  );
  EXECUTE v_sql;
END
$migration$;
