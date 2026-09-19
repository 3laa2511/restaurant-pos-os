-- ============================================================================
-- BO'SH STORE — GAMING BRANCH OWNERSHIP
-- Enforce station/session/reservation branch consistency at the database layer.
-- ============================================================================

-- A station may only reference a real active branch. This closes the gap where
-- a service-role write could otherwise create an orphaned branch assignment.
CREATE OR REPLACE FUNCTION enforce_gaming_station_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active BOOLEAN;
BEGIN
  IF NEW.branch_id IS NULL THEN
    RAISE EXCEPTION 'Gaming station branch_id is required';
  END IF;

  SELECT is_active INTO v_active
  FROM branches
  WHERE id = NEW.branch_id;

  IF v_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Gaming station branch does not exist or is inactive';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gaming_stations_branch_ownership ON gaming_stations;
CREATE TRIGGER trg_gaming_stations_branch_ownership
BEFORE INSERT OR UPDATE OF branch_id ON gaming_stations
FOR EACH ROW EXECUTE FUNCTION enforce_gaming_station_branch();

-- Sessions inherit ownership from their station and may never point at a
-- station belonging to a different branch.
CREATE OR REPLACE FUNCTION set_gaming_session_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station_branch UUID;
BEGIN
  IF NEW.station_id IS NOT NULL THEN
    SELECT branch_id INTO v_station_branch FROM gaming_stations WHERE id = NEW.station_id;
    IF v_station_branch IS NOT NULL AND NEW.branch_id IS NULL THEN
      NEW.branch_id := v_station_branch;
    ELSIF v_station_branch IS NOT NULL AND NEW.branch_id IS DISTINCT FROM v_station_branch THEN
      RAISE EXCEPTION 'Gaming session branch does not match station branch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gaming_sessions_branch_ownership ON gaming_sessions;
CREATE TRIGGER trg_gaming_sessions_branch_ownership
BEFORE INSERT OR UPDATE OF station_id, branch_id ON gaming_sessions
FOR EACH ROW EXECUTE FUNCTION set_gaming_session_branch();

-- Reservations follow the selected station's branch.
CREATE OR REPLACE FUNCTION set_gaming_reservation_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station_branch UUID;
BEGIN
  IF NEW.station_id IS NOT NULL THEN
    SELECT branch_id INTO v_station_branch FROM gaming_stations WHERE id = NEW.station_id;
    IF v_station_branch IS NOT NULL AND NEW.branch_id IS NULL THEN
      NEW.branch_id := v_station_branch;
    ELSIF v_station_branch IS NOT NULL AND NEW.branch_id IS DISTINCT FROM v_station_branch THEN
      RAISE EXCEPTION 'Gaming reservation branch does not match station branch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gaming_reservations_branch_ownership ON gaming_reservations;
CREATE TRIGGER trg_gaming_reservations_branch_ownership
BEFORE INSERT OR UPDATE OF station_id, branch_id ON gaming_reservations
FOR EACH ROW EXECUTE FUNCTION set_gaming_reservation_branch();

CREATE INDEX IF NOT EXISTS idx_gaming_stations_branch_id ON gaming_stations(branch_id);
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_branch_id ON gaming_sessions(branch_id);
CREATE INDEX IF NOT EXISTS idx_gaming_reservations_branch_id ON gaming_reservations(branch_id);

-- Existing rows created before branch isolation are intentionally assigned to
-- MAIN by the foundation/backfill migrations. This migration only protects
-- future writes and station/session/reservation consistency.
