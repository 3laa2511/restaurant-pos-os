-- ============================================================================
-- BO'SH STORE — STAFF WORK AREA SCOPE
-- Branch remains the hard data boundary; work_area narrows operational access.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS work_area VARCHAR(50);

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_work_area_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_work_area_check
  CHECK (
    work_area IS NULL OR work_area IN (
      'store', 'pos', 'gaming', 'repairs', 'inventory', 'delivery', 'finance', 'management'
    )
  );

CREATE INDEX IF NOT EXISTS idx_profiles_branch_work_area
  ON profiles(branch_id, work_area)
  WHERE is_active = true;

COMMENT ON COLUMN profiles.work_area IS
  'Narrow operational scope inside the assigned branch. It must never replace branch isolation.';
