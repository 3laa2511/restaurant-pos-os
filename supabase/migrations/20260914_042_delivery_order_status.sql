-- ============================================================================
-- BO'SH STORE — DELIVERY ORDER STATE FOUNDATION
-- Adds the explicit delivery state used by the delivery domain.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'order_status_enum'
      AND e.enumlabel = 'out_for_delivery'
  ) THEN
    ALTER TYPE order_status_enum ADD VALUE 'out_for_delivery';
  END IF;
END
$$;
