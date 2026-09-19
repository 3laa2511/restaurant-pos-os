-- 20260919_076_shift_summary_refund_source_alignment
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

  v_sql := replace(
    v_sql,
    '  -- If no payment_refunds records exist yet (legacy), fallback to cash_drawer_movements
  IF v_cash_refunds = 0 THEN
    SELECT COALESCE(SUM(m.amount), 0)
    INTO v_cash_refunds
    FROM cash_drawer_movements m
    WHERE m.shift_id = v_shift.id AND m.type = ''refund_cash'';
    IF v_total_refunds = 0 THEN
      v_total_refunds := v_cash_refunds;
    END IF;
  END IF;',
    '  SELECT
    v_total_refunds + COALESCE(SUM(prs.amount), 0),
    v_cash_refunds + COALESCE(SUM(prs.cash_amount), 0),
    v_non_cash_refunds + COALESCE(SUM(prs.card_amount + prs.wallet_amount), 0),
    v_refunds_count + COUNT(prs.id)
  INTO
    v_total_refunds,
    v_cash_refunds,
    v_non_cash_refunds,
    v_refunds_count
  FROM pos_refund_settlements prs
  WHERE prs.shift_id = v_shift.id
    AND prs.status = ''completed'';'
  );

  IF position('pos_refund_settlements prs' IN v_sql) = 0 THEN
    RAISE EXCEPTION 'ERR_MIGRATION_REFUND_SOURCE_INSERT_FAILED';
  END IF;

  EXECUTE v_sql;
END
$migration$;
