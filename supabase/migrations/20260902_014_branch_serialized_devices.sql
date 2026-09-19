-- BO'SH STORE — BRANCH-SCOPED SERIALIZED INVENTORY
-- Serialized devices are owned by the branch of their warehouse.

ALTER TABLE serialized_devices
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_serialized_devices_branch
  ON serialized_devices(branch_id);

UPDATE serialized_devices sd
SET branch_id = w.branch_id
FROM warehouses w
WHERE sd.branch_id IS NULL
  AND sd.warehouse_id = w.id
  AND w.branch_id IS NOT NULL;

-- Legacy devices without a warehouse are assigned to MAIN so existing data
-- remains visible to the main branch after branch isolation is enabled.
UPDATE serialized_devices sd
SET branch_id = b.id
FROM branches b
WHERE sd.branch_id IS NULL
  AND b.code = 'MAIN';

CREATE OR REPLACE FUNCTION set_serialized_device_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id UUID;
BEGIN
  IF NEW.branch_id IS NULL AND NEW.warehouse_id IS NOT NULL THEN
    SELECT branch_id INTO v_branch_id
    FROM warehouses
    WHERE id = NEW.warehouse_id;
    NEW.branch_id := v_branch_id;
  END IF;

  IF NEW.branch_id IS NULL THEN
    SELECT id INTO v_branch_id FROM branches WHERE code = 'MAIN' LIMIT 1;
    NEW.branch_id := v_branch_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_serialized_devices_branch_ownership ON serialized_devices;
CREATE TRIGGER trg_serialized_devices_branch_ownership
BEFORE INSERT OR UPDATE OF warehouse_id, branch_id ON serialized_devices
FOR EACH ROW EXECUTE FUNCTION set_serialized_device_branch();
