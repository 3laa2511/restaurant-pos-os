-- ==============================================================================
-- BO'SH STORE — AUTH PROFILE HARDENING
-- Migration: 20260902_006_auth_profile_hardening
-- Purpose: Bind staff identity to Supabase Auth and make profile reads safe.
-- ==============================================================================

-- The application authenticates against Supabase Auth (auth.users). Every
-- privileged profile must therefore be linked by user_id, never by email.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_unique_idx
  ON profiles (user_id)
  WHERE user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_user_id_auth_users_fkey'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_user_id_auth_users_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Clients may read only their own profile. Role, permissions, activation state,
-- and all other privileged fields remain server-managed via service_role.
DROP POLICY IF EXISTS "Authenticated users can view own profile" ON profiles;
CREATE POLICY "Authenticated users can view own profile" ON profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Explicitly prevent browser clients from changing privileged profile fields.
DROP POLICY IF EXISTS "Authenticated users cannot modify profiles" ON profiles;
CREATE POLICY "Authenticated users cannot modify profiles" ON profiles
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Authenticated users cannot insert profiles" ON profiles;
CREATE POLICY "Authenticated users cannot insert profiles" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Authenticated users cannot delete profiles" ON profiles;
CREATE POLICY "Authenticated users cannot delete profiles" ON profiles
  FOR DELETE TO authenticated
  USING (false);
