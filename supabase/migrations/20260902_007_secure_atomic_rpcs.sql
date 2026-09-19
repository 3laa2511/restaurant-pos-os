-- ==============================================================================
-- BO'SH STORE — ATOMIC RPC EXECUTION HARDENING
-- Migration: 20260902_007_secure_atomic_rpcs
-- Purpose: Keep privileged atomic operations callable only by service_role.
-- ============================================================================

REVOKE ALL ON FUNCTION fn_deduct_inventory_atomic(UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_atomic_checkout(JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION fn_deduct_inventory_atomic(UUID, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_atomic_checkout(JSONB) TO service_role;

-- Do not redefine the functions here. Migration 005 contains the authoritative
-- implementations; redefining them here would risk replacing working logic.
-- The privilege boundary above is sufficient because the application invokes
-- these RPCs through the server-only Supabase service-role client.