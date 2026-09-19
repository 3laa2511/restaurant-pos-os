
-- 20260919_070_refund_payment_immutability_alignment
-- Refunds are represented by durable refund/reversal records and must not mutate
-- an immutable settled payment row. Full and partial refund flows therefore keep
-- the original payment status=paid and update the order/refund ledgers instead.

DO $migration$
DECLARE
  v_sql TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_atomic_pos_partial_refund'
    AND pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb';

  IF v_sql IS NULL THEN
    RAISE EXCEPTION 'ERR_MIGRATION_SOURCE_FUNCTION_MISSING: fn_atomic_pos_partial_refund';
  END IF;

  IF position('UPDATE payments SET status = ''refunded'' WHERE order_id = v_order_id AND status = ''paid'';' IN v_sql) = 0 THEN
    RAISE EXCEPTION 'ERR_MIGRATION_EXPECTED_PAYMENT_MUTATION_NOT_FOUND: partial refund function';
  END IF;

  v_sql := replace(
    v_sql,
    'UPDATE payments SET status = ''refunded'' WHERE order_id = v_order_id AND status = ''paid'';',
    'NULL; -- Settled payment rows are immutable; refund state is represented by pos_refund_settlements and orders.'
  );
  EXECUTE v_sql;

  SELECT pg_get_functiondef(p.oid)
  INTO v_sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_atomic_pos_refund'
    AND pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid, p_branch_id uuid, p_cashier_id uuid, p_shift_id uuid, p_reason text';

  IF v_sql IS NULL THEN
    RAISE EXCEPTION 'ERR_MIGRATION_SOURCE_FUNCTION_MISSING: fn_atomic_pos_refund';
  END IF;

  IF position('UPDATE payments' IN v_sql) = 0 THEN
    RAISE EXCEPTION 'ERR_MIGRATION_EXPECTED_PAYMENT_MUTATION_NOT_FOUND: full refund function';
  END IF;

  v_sql := regexp_replace(
    v_sql,
    'UPDATE payments[[:space:]]+SET status = ''refunded''[[:space:]]+WHERE id = v_payment\.id;',
    'NULL; -- Settled payment rows are immutable; refund state is represented by payment_refunds and orders.'
  );
  EXECUTE v_sql;
END
$migration$;
