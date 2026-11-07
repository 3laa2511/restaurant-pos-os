-- Phase 5 preparation: make authentication compatible with upcoming FORCE RLS.
-- This migration intentionally does NOT enable RLS yet. It only adds the
-- pre-auth username context and splits User/UserRole policies so login can
-- resolve exactly one requested user without granting unauthenticated tenant access.

CREATE OR REPLACE FUNCTION app.current_login_username()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.login_username', true), '');
$$;

DROP POLICY IF EXISTS tenant_isolation ON "User";
DROP POLICY IF EXISTS user_select ON "User";
DROP POLICY IF EXISTS user_modify ON "User";

CREATE POLICY user_select ON "User"
  FOR SELECT
  USING (
    (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
    OR "username" = app.current_login_username()
  );

CREATE POLICY user_modify ON "User"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "UserRole";
DROP POLICY IF EXISTS user_role_select ON "UserRole";
DROP POLICY IF EXISTS user_role_modify ON "UserRole";

CREATE POLICY user_role_select ON "UserRole"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "UserRole"."userId"
        AND (
          (app.tenant_visible(u."tenantId") AND app.branch_visible(u."branchId"))
          OR u."username" = app.current_login_username()
        )
    )
  );

CREATE POLICY user_role_modify ON "UserRole"
  USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "UserRole"."userId"
        AND app.tenant_visible(u."tenantId")
        AND app.branch_visible(u."branchId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "UserRole"."userId"
        AND app.tenant_visible(u."tenantId")
        AND app.branch_visible(u."branchId")
    )
  );

-- Keep this migration intentionally preparation-only. Enforcement follows after
-- the authentication code is deployed and integration tests prove the bootstrap
-- path.
