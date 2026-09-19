-- ============================================================================
-- BO'SH STORE — PHASE 4.7 SQL COMPATIBILITY HARDENING
-- Migration: 20260904_021_numeric_finite_compatibility
-- Purpose: provide the numeric overload used by the approval-consumption
-- function. PostgreSQL's built-in isfinite() overloads cover date/timestamp/
-- interval; numeric supports NaN/Infinity as special values instead.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.isfinite(p_value NUMERIC)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT p_value <> 'NaN'::NUMERIC
     AND p_value <> 'Infinity'::NUMERIC
     AND p_value <> '-Infinity'::NUMERIC;
$$;

REVOKE ALL ON FUNCTION public.isfinite(NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.isfinite(NUMERIC) TO service_role;
