-- ============================================================================
-- BO'SH STORE — STAFF ACCESS SCOPE HARDENING
-- Migration: 20260906_036_staff_access_scope_hardening
-- Purpose:
--   1. Make per-user permissions revocable instead of always unioning role defaults.
--   2. Require every non-global active staff account to belong to exactly one branch.
--   3. Keep owner/admin globally scoped while branch staff remain branch-scoped.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS permissions_override BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_active_branch_role
  ON profiles(branch_id, role, is_active);

-- Existing non-global staff are assigned to the safe MAIN branch before the
-- enforcement trigger is installed. This avoids silently leaving staff with
-- an unscoped operational account after this migration.
UPDATE profiles
SET branch_id = (SELECT id FROM branches WHERE code = 'MAIN' LIMIT 1)
WHERE role NOT IN ('owner', 'admin', 'customer')
  AND branch_id IS NULL;

CREATE OR REPLACE FUNCTION enforce_staff_access_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role NOT IN ('owner', 'admin', 'customer')
     AND NEW.is_active = true
     AND NEW.branch_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_BRANCH_REQUIRED';
  END IF;

  IF NEW.role = 'customer' THEN
    NEW.permissions_override := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_access_scope ON profiles;
CREATE TRIGGER trg_staff_access_scope
BEFORE INSERT OR UPDATE OF role, branch_id, is_active ON profiles
FOR EACH ROW
EXECUTE FUNCTION enforce_staff_access_scope();

COMMENT ON COLUMN profiles.permissions_override IS
  'When true, permissions is the exact user permission set and may revoke role defaults. When false, role defaults are used.';
COMMENT ON COLUMN profiles.branch_id IS
  'Operational branch/lounges scope for staff. Required for active non-global staff; owner/admin are globally scoped.';
