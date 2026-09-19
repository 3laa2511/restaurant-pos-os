-- ============================================================================
-- BO'SH STORE — BRANCH OWNERSHIP TRIGGERS
-- Branch ownership is derived from server-side identity, never from client data.
-- ============================================================================

CREATE OR REPLACE FUNCTION set_order_branch_from_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id UUID;
BEGIN
  IF NEW.entity IN ('orders', 'Order') AND NEW.entity_id IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    SELECT p.branch_id INTO v_branch_id FROM profiles p WHERE p.user_id = NEW.user_id;
    IF v_branch_id IS NOT NULL THEN
      UPDATE orders SET branch_id = v_branch_id, updated_at = NOW()
      WHERE id::text = NEW.entity_id AND branch_id IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_branch_ownership ON orders;
DROP FUNCTION IF EXISTS set_order_branch_from_cashier();
DROP TRIGGER IF EXISTS trg_audit_orders_branch_ownership ON audit_logs;
CREATE TRIGGER trg_audit_orders_branch_ownership
AFTER INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION set_order_branch_from_audit();

CREATE OR REPLACE FUNCTION set_inventory_movement_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL AND NEW.reference_type = 'order' AND NEW.reference_id IS NOT NULL THEN
    SELECT o.branch_id INTO NEW.branch_id FROM orders o WHERE o.id::text = NEW.reference_id;
  END IF;
  IF NEW.branch_id IS NULL AND NEW.warehouse_id IS NOT NULL THEN
    SELECT w.branch_id INTO NEW.branch_id FROM warehouses w WHERE w.id = NEW.warehouse_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_movements_branch_ownership ON inventory_movements;
CREATE TRIGGER trg_inventory_movements_branch_ownership
BEFORE INSERT ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION set_inventory_movement_branch();

CREATE OR REPLACE FUNCTION sync_order_inventory_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL AND (OLD.branch_id IS DISTINCT FROM NEW.branch_id) THEN
    UPDATE inventory_movements SET branch_id = NEW.branch_id
    WHERE reference_type = 'order' AND reference_id = NEW.id::text AND branch_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_inventory_branch_sync ON orders;
CREATE TRIGGER trg_orders_inventory_branch_sync
AFTER UPDATE OF branch_id ON orders
FOR EACH ROW EXECUTE FUNCTION sync_order_inventory_branch();
