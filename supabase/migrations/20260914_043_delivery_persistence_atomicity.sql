-- ============================================================================
-- BO'SH STORE — DELIVERY DRIVER PERSISTENCE & ATOMIC ASSIGNMENT
-- Production authority for drivers and Driver <-> Order state transitions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS delivery_drivers (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),
  phone VARCHAR(50) NOT NULL,
  national_id VARCHAR(100),
  vehicle_type VARCHAR(30) NOT NULL DEFAULT 'motorcycle'
    CHECK (vehicle_type IN ('motorcycle', 'car', 'van', 'bicycle')),
  vehicle_plate VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'on_delivery', 'busy', 'offline')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  max_active_deliveries INT NOT NULL DEFAULT 5 CHECK (max_active_deliveries > 0),
  branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_drivers_phone
  ON delivery_drivers(phone);
CREATE INDEX IF NOT EXISTS idx_delivery_drivers_branch_status
  ON delivery_drivers(branch_id, status);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS assigned_driver_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS assigned_driver_name VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_assigned_driver_fk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_assigned_driver_fk
      FOREIGN KEY (assigned_driver_id)
      REFERENCES delivery_drivers(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_assigned_driver
  ON orders(assigned_driver_id)
  WHERE assigned_driver_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_assignment_idempotency (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  operation VARCHAR(20) NOT NULL CHECK (operation IN ('assign', 'unassign')),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id VARCHAR(100) NOT NULL REFERENCES delivery_drivers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_assignment_idempotency_order
  ON delivery_assignment_idempotency(order_id);

CREATE OR REPLACE FUNCTION fn_atomic_driver_assignment(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID := NULLIF(TRIM(p_payload->>'order_id'), '')::UUID;
  v_driver_id VARCHAR(100) := NULLIF(TRIM(p_payload->>'driver_id'), '');
  v_actor_id VARCHAR(100) := NULLIF(TRIM(p_payload->>'actor_id'), '');
  v_actor_name VARCHAR(255) := COALESCE(NULLIF(TRIM(p_payload->>'actor_name'), ''), 'System');
  v_actor_role VARCHAR(50) := COALESCE(NULLIF(TRIM(p_payload->>'actor_role'), ''), 'system');
  v_actor_branch_id UUID := NULLIF(TRIM(p_payload->>'actor_branch_id'), '')::UUID;
  v_idempotency_key VARCHAR(255) := NULLIF(TRIM(p_payload->>'idempotency_key'), '');
  v_order orders%ROWTYPE;
  v_driver delivery_drivers%ROWTYPE;
  v_existing delivery_assignment_idempotency%ROWTYPE;
  v_active_orders INT := 0;
  v_next_status VARCHAR(30);
  v_result JSONB;
BEGIN
  IF v_order_id IS NULL OR v_driver_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_ASSIGNMENT: order_id and driver_id are required';
  END IF;

  -- Both locks are always acquired in driver -> order order to avoid deadlocks.
  PERFORM pg_advisory_xact_lock(hashtextextended('delivery-driver:' || v_driver_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('delivery-order:' || v_order_id::text, 0));

  SELECT * INTO v_driver
  FROM delivery_drivers
  WHERE id = v_driver_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: Driver % was not found', v_driver_id;
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = v_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: Order % was not found', v_order_id;
  END IF;

  IF v_actor_branch_id IS NOT NULL THEN
    IF v_driver.branch_id IS NULL OR v_driver.branch_id <> v_actor_branch_id THEN
      RAISE EXCEPTION 'ERR_BRANCH_SCOPE: Driver belongs to another branch';
    END IF;
    IF v_order.branch_id IS NULL OR v_order.branch_id <> v_actor_branch_id THEN
      RAISE EXCEPTION 'ERR_BRANCH_SCOPE: Order belongs to another branch';
    END IF;
  END IF;

  IF v_driver.branch_id IS DISTINCT FROM v_order.branch_id THEN
    RAISE EXCEPTION 'ERR_BRANCH_MISMATCH: Driver and order must belong to the same branch';
  END IF;

  IF NOT v_driver.is_active THEN
    RAISE EXCEPTION 'ERR_DRIVER_INACTIVE: Driver is inactive';
  END IF;

  IF v_order.status::text IN ('cancelled', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'ERR_ORDER_STATUS: Order cannot be assigned in % status', v_order.status;
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    INSERT INTO delivery_assignment_idempotency(idempotency_key, operation, order_id, driver_id)
    VALUES (v_idempotency_key, 'assign', v_order_id, v_driver_id)
    ON CONFLICT (idempotency_key) DO NOTHING;

    SELECT * INTO v_existing
    FROM delivery_assignment_idempotency
    WHERE idempotency_key = v_idempotency_key
    FOR UPDATE;

    IF v_existing.operation <> 'assign'
       OR v_existing.order_id <> v_order_id
       OR v_existing.driver_id <> v_driver_id THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REUSED: Assignment idempotency key is bound to another operation';
    END IF;

    IF v_order.assigned_driver_id = v_driver_id THEN
      SELECT COUNT(*) INTO v_active_orders
      FROM orders
      WHERE assigned_driver_id = v_driver_id
        AND status::text NOT IN ('delivered', 'cancelled', 'returned');

      v_next_status := CASE
        WHEN v_active_orders >= v_driver.max_active_deliveries THEN 'busy'
        ELSE 'on_delivery'
      END;

      UPDATE delivery_drivers
      SET status = v_next_status, updated_at = NOW()
      WHERE id = v_driver_id;

      RETURN jsonb_build_object(
        'success', true,
        'already_assigned', true,
        'driver', jsonb_build_object(
          'id', v_driver.id,
          'name', v_driver.name,
          'name_ar', v_driver.name_ar,
          'phone', v_driver.phone,
          'national_id', v_driver.national_id,
          'vehicle_type', v_driver.vehicle_type,
          'vehicle_plate', v_driver.vehicle_plate,
          'status', v_next_status,
          'is_active', v_driver.is_active,
          'max_active_deliveries', v_driver.max_active_deliveries,
          'branch_id', v_driver.branch_id,
          'notes', v_driver.notes,
          'created_at', v_driver.created_at,
          'updated_at', NOW()
        ),
        'order_id', v_order.id,
        'order_number', v_order.order_number
      );
    END IF;
  END IF;

  IF v_order.assigned_driver_id IS NOT NULL AND v_order.assigned_driver_id <> v_driver_id THEN
    RAISE EXCEPTION 'ERR_ORDER_ALREADY_ASSIGNED: Order is already assigned to another driver';
  END IF;

  SELECT COUNT(*) INTO v_active_orders
  FROM orders
  WHERE assigned_driver_id = v_driver_id
    AND status::text NOT IN ('delivered', 'cancelled', 'returned');

  IF v_order.assigned_driver_id IS NULL AND v_active_orders >= v_driver.max_active_deliveries THEN
    RAISE EXCEPTION 'ERR_DRIVER_CAPACITY: Driver has reached maximum active delivery capacity (%)', v_driver.max_active_deliveries;
  END IF;

  UPDATE orders
  SET assigned_driver_id = v_driver_id,
      assigned_driver_name = v_driver.name,
      status = 'out_for_delivery',
      updated_at = NOW()
  WHERE id = v_order_id;

  v_active_orders := v_active_orders + CASE WHEN v_order.assigned_driver_id IS NULL THEN 1 ELSE 0 END;
  v_next_status := CASE
    WHEN v_active_orders >= v_driver.max_active_deliveries THEN 'busy'
    ELSE 'on_delivery'
  END;

  UPDATE delivery_drivers
  SET status = v_next_status, updated_at = NOW()
  WHERE id = v_driver_id
  RETURNING * INTO v_driver;

  INSERT INTO audit_logs(user_id, user_name, user_role, action, entity, entity_id, new_value, details, created_at)
  VALUES (
    v_actor_id, v_actor_name, v_actor_role, 'ORDER_DRIVER_ASSIGNED', 'ORDER', v_order_id::text,
    jsonb_build_object('driver_id', v_driver_id, 'order_number', v_order.order_number)::text,
    'Order assigned to delivery driver atomically', NOW()
  );

  SELECT jsonb_build_object(
    'success', true,
    'already_assigned', false,
    'driver', jsonb_build_object(
      'id', v_driver.id,
      'name', v_driver.name,
      'name_ar', v_driver.name_ar,
      'phone', v_driver.phone,
      'national_id', v_driver.national_id,
      'vehicle_type', v_driver.vehicle_type,
      'vehicle_plate', v_driver.vehicle_plate,
      'status', v_driver.status,
      'is_active', v_driver.is_active,
      'max_active_deliveries', v_driver.max_active_deliveries,
      'branch_id', v_driver.branch_id,
      'notes', v_driver.notes,
      'created_at', v_driver.created_at,
      'updated_at', v_driver.updated_at,
      'current_order_ids', COALESCE((SELECT jsonb_agg(o.id::text ORDER BY o.created_at) FROM orders o WHERE o.assigned_driver_id = v_driver.id AND o.status::text NOT IN ('delivered', 'cancelled', 'returned')), '[]'::jsonb)
    ),
    'order_id', v_order_id,
    'order_number', v_order.order_number
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION fn_atomic_driver_unassignment(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID := NULLIF(TRIM(p_payload->>'order_id'), '')::UUID;
  v_driver_id VARCHAR(100) := NULLIF(TRIM(p_payload->>'driver_id'), '');
  v_actor_id VARCHAR(100) := NULLIF(TRIM(p_payload->>'actor_id'), '');
  v_actor_name VARCHAR(255) := COALESCE(NULLIF(TRIM(p_payload->>'actor_name'), ''), 'System');
  v_actor_role VARCHAR(50) := COALESCE(NULLIF(TRIM(p_payload->>'actor_role'), ''), 'system');
  v_actor_branch_id UUID := NULLIF(TRIM(p_payload->>'actor_branch_id'), '')::UUID;
  v_idempotency_key VARCHAR(255) := NULLIF(TRIM(p_payload->>'idempotency_key'), '');
  v_order orders%ROWTYPE;
  v_driver delivery_drivers%ROWTYPE;
  v_existing delivery_assignment_idempotency%ROWTYPE;
  v_active_orders INT := 0;
  v_next_status VARCHAR(30);
BEGIN
  IF v_order_id IS NULL OR v_driver_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_ASSIGNMENT: order_id and driver_id are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('delivery-driver:' || v_driver_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('delivery-order:' || v_order_id::text, 0));

  SELECT * INTO v_driver FROM delivery_drivers WHERE id = v_driver_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_NOT_FOUND: Driver was not found'; END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ERR_NOT_FOUND: Order was not found'; END IF;

  IF v_actor_branch_id IS NOT NULL THEN
    IF v_driver.branch_id IS NULL OR v_driver.branch_id <> v_actor_branch_id THEN
      RAISE EXCEPTION 'ERR_BRANCH_SCOPE: Driver belongs to another branch';
    END IF;
    IF v_order.branch_id IS NULL OR v_order.branch_id <> v_actor_branch_id THEN
      RAISE EXCEPTION 'ERR_BRANCH_SCOPE: Order belongs to another branch';
    END IF;
  END IF;

  IF v_driver.branch_id IS DISTINCT FROM v_order.branch_id THEN
    RAISE EXCEPTION 'ERR_BRANCH_MISMATCH: Driver and order must belong to the same branch';
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    INSERT INTO delivery_assignment_idempotency(idempotency_key, operation, order_id, driver_id)
    VALUES (v_idempotency_key, 'unassign', v_order_id, v_driver_id)
    ON CONFLICT (idempotency_key) DO NOTHING;

    SELECT * INTO v_existing FROM delivery_assignment_idempotency WHERE idempotency_key = v_idempotency_key FOR UPDATE;
    IF v_existing.operation <> 'unassign' OR v_existing.order_id <> v_order_id OR v_existing.driver_id <> v_driver_id THEN
      RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REUSED: Assignment idempotency key is bound to another operation';
    END IF;

    IF v_order.assigned_driver_id IS NULL THEN
      SELECT COUNT(*) INTO v_active_orders FROM orders WHERE assigned_driver_id = v_driver_id AND status::text NOT IN ('delivered', 'cancelled', 'returned');
      v_next_status := CASE WHEN v_active_orders >= v_driver.max_active_deliveries THEN 'busy' ELSE 'on_delivery' END;
      UPDATE delivery_drivers SET status = v_next_status, updated_at = NOW() WHERE id = v_driver_id;
      RETURN jsonb_build_object('success', true, 'already_unassigned', true, 'driver_id', v_driver_id, 'order_id', v_order_id);
    END IF;
  END IF;

  IF v_order.assigned_driver_id IS NOT NULL AND v_order.assigned_driver_id <> v_driver_id THEN
    RAISE EXCEPTION 'ERR_DRIVER_MISMATCH: Order is assigned to another driver';
  END IF;

  UPDATE orders
  SET assigned_driver_id = NULL,
      assigned_driver_name = NULL,
      status = CASE WHEN status::text = 'out_for_delivery' THEN 'ready_for_shipping'::order_status_enum ELSE status END,
      updated_at = NOW()
  WHERE id = v_order_id;

  SELECT COUNT(*) INTO v_active_orders
  FROM orders
  WHERE assigned_driver_id = v_driver_id
    AND status::text NOT IN ('delivered', 'cancelled', 'returned');

  v_next_status := CASE WHEN v_active_orders = 0 THEN 'available' ELSE CASE WHEN v_active_orders >= v_driver.max_active_deliveries THEN 'busy' ELSE 'on_delivery' END END;

  UPDATE delivery_drivers SET status = v_next_status, updated_at = NOW() WHERE id = v_driver_id;

  INSERT INTO audit_logs(user_id, user_name, user_role, action, entity, entity_id, previous_value, new_value, details, created_at)
  VALUES (
    v_actor_id, v_actor_name, v_actor_role, 'ORDER_DRIVER_UNASSIGNED', 'ORDER', v_order_id::text,
    jsonb_build_object('driver_id', v_driver_id)::text, NULL,
    'Order unassigned from delivery driver atomically', NOW()
  );

  RETURN jsonb_build_object('success', true, 'already_unassigned', false, 'driver_id', v_driver_id, 'order_id', v_order_id, 'status', v_next_status);
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_driver_assignment(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_atomic_driver_unassignment(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_driver_assignment(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION fn_atomic_driver_unassignment(JSONB) TO service_role;

ALTER TABLE delivery_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_assignment_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON delivery_drivers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON delivery_assignment_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_drivers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_assignment_idempotency TO service_role;
