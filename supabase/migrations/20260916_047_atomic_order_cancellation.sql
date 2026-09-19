-- ==============================================================================
-- BO'SH STORE — ATOMIC ORDER CANCELLATION
-- Migration: 20260916_047_atomic_order_cancellation
-- Purpose: make cancellation a single database transaction covering order state,
--          branch stock restoration, inventory movements, driver release,
--          status history, idempotency and audit logging.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS order_cancellation_idempotency (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  actor_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_cancel_idempotency_order
  ON order_cancellation_idempotency(order_id);

CREATE OR REPLACE FUNCTION fn_atomic_order_cancellation(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID := NULLIF(TRIM(p_payload->>'order_id'), '')::UUID;
  v_actor_id VARCHAR(100) := NULLIF(TRIM(p_payload->>'actor_id'), '');
  v_actor_name VARCHAR(255) := COALESCE(NULLIF(TRIM(p_payload->>'actor_name'), ''), 'System');
  v_actor_role VARCHAR(50) := COALESCE(NULLIF(TRIM(p_payload->>'actor_role'), ''), 'system');
  v_actor_branch_id UUID := NULLIF(TRIM(p_payload->>'actor_branch_id'), '')::UUID;
  v_reason TEXT := COALESCE(NULLIF(TRIM(p_payload->>'reason'), ''), 'Order cancelled');
  v_key VARCHAR(255) := COALESCE(NULLIF(TRIM(p_payload->>'idempotency_key'), ''), 'ORDER_CANCEL:' || v_order_id::text);
  v_order orders%ROWTYPE;
  v_existing order_cancellation_idempotency%ROWTYPE;
  v_item RECORD;
  v_stock RECORD;
  v_driver delivery_drivers%ROWTYPE;
  v_active_orders INT := 0;
  v_driver_status VARCHAR(30);
  v_restored_items INT := 0;
BEGIN
  IF v_order_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'ERR_INVALID_CANCEL_REQUEST: order_id and actor_id are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:order-cancel:' || v_order_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('boshi:order-cancel-key:' || v_key, 0));

  IF NOT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = v_actor_id::UUID
      AND p.is_active = true
      AND p.role <> 'customer'
      AND (
        (p.permissions_override = true AND p.permissions ? 'orders.update')
        OR
        (p.permissions_override = false AND p.role IN ('owner','admin','store_manager','manager'))
      )
  ) THEN
    RAISE EXCEPTION 'ERR_PERMISSION_DENIED: Staff account is not authorized to cancel orders';
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ORDER_NOT_FOUND: Order does not exist';
  END IF;

  IF v_actor_branch_id IS NULL AND v_order.branch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles
      WHERE user_id = v_actor_id::UUID
        AND role IN ('owner','admin')
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'ERR_BRANCH_REQUIRED: Staff branch assignment is required for cancellation';
    END IF;
  END IF;

  IF v_actor_branch_id IS NOT NULL AND (v_order.branch_id IS NULL OR v_order.branch_id <> v_actor_branch_id) THEN
    RAISE EXCEPTION 'ERR_BRANCH_SCOPE: Order belongs to another branch';
  END IF;

  INSERT INTO order_cancellation_idempotency(idempotency_key, order_id, actor_id)
  VALUES (v_key, v_order_id, v_actor_id)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT * INTO v_existing
  FROM order_cancellation_idempotency
  WHERE idempotency_key = v_key
  FOR UPDATE;

  IF v_existing.order_id <> v_order_id THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REUSED: Cancellation idempotency key is bound to another order';
  END IF;

  IF v_order.status::text = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_cancelled', true,
      'order_id', v_order_id,
      'order_number', v_order.order_number,
      'status', 'cancelled'
    );
  END IF;

  IF v_order.payment_status::text IN ('paid', 'partially_paid', 'refunded') THEN
    RAISE EXCEPTION 'ERR_PAID_ORDER_USE_REFUND: Paid orders must be reversed through the protected refund flow';
  END IF;

  IF v_order.status::text NOT IN ('pending','confirmed','preparing','ready_for_shipping','out_for_delivery') THEN
    RAISE EXCEPTION 'ERR_INVALID_ORDER_TRANSITION: Order status % cannot be cancelled', v_order.status;
  END IF;

  IF v_order.inventory_deducted = true AND v_order.branch_id IS NULL THEN
    RAISE EXCEPTION 'ERR_BRANCH_REQUIRED: Inventory-deducted order has no branch ownership';
  END IF;

  IF v_order.inventory_deducted = true THEN
    FOR v_item IN
      SELECT oi.product_id, oi.product_name, oi.sku, oi.quantity
      FROM order_items oi
      WHERE oi.order_id = v_order_id
        AND oi.product_id IS NOT NULL
      ORDER BY oi.product_id
    LOOP
      INSERT INTO branch_inventory_stock(branch_id, product_id, stock_quantity)
      VALUES (v_order.branch_id, v_item.product_id, 0)
      ON CONFLICT (branch_id, product_id) DO NOTHING;

      SELECT bis.stock_quantity, bis.low_stock_threshold
      INTO v_stock
      FROM branch_inventory_stock bis
      WHERE bis.branch_id = v_order.branch_id
        AND bis.product_id = v_item.product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_STOCK_ROW_NOT_FOUND: Branch stock row is unavailable for product %', v_item.product_id;
      END IF;

      UPDATE branch_inventory_stock
      SET stock_quantity = v_stock.stock_quantity + v_item.quantity,
          updated_at = NOW()
      WHERE branch_id = v_order.branch_id
        AND product_id = v_item.product_id;

      INSERT INTO inventory_movements (
        product_id, product_name, sku, type, quantity,
        previous_quantity, resulting_quantity, reason,
        reference_type, reference_id, performed_by, branch_id, created_at
      ) VALUES (
        v_item.product_id, v_item.product_name, v_item.sku, 'return', v_item.quantity,
        v_stock.stock_quantity, v_stock.stock_quantity + v_item.quantity,
        v_reason, 'order', v_order_id::text, v_actor_name, v_order.branch_id, NOW()
      );

      v_restored_items := v_restored_items + 1;
    END LOOP;
  END IF;

  -- Driver assignment uses driver -> order locking. Do not wait on its driver
  -- lock while holding the order lock: fail and roll back so the concurrent
  -- assignment can finish, then the caller can retry safely.
  IF v_order.assigned_driver_id IS NOT NULL THEN
    IF NOT pg_try_advisory_xact_lock(hashtextextended('delivery-driver:' || v_order.assigned_driver_id, 0)) THEN
      RAISE EXCEPTION 'ERR_CONCURRENT_DRIVER_ASSIGNMENT: Driver assignment is changing; retry cancellation';
    END IF;

    SELECT * INTO v_driver
    FROM delivery_drivers
    WHERE id = v_order.assigned_driver_id
    FOR UPDATE NOWAIT;

    IF FOUND THEN
      UPDATE orders
      SET assigned_driver_id = NULL,
          assigned_driver_name = NULL
      WHERE id = v_order_id;

      SELECT COUNT(*) INTO v_active_orders
      FROM orders
      WHERE assigned_driver_id = v_driver.id
        AND status::text NOT IN ('delivered','cancelled','returned');

      v_driver_status := CASE
        WHEN v_active_orders = 0 THEN 'available'
        WHEN v_active_orders >= v_driver.max_active_deliveries THEN 'busy'
        ELSE 'on_delivery'
      END;

      UPDATE delivery_drivers
      SET status = v_driver_status,
          updated_at = NOW()
      WHERE id = v_driver.id;
    ELSE
      RAISE EXCEPTION 'ERR_DRIVER_NOT_FOUND: Assigned delivery driver no longer exists';
    END IF;
  END IF;

  UPDATE orders
  SET status = 'cancelled',
      inventory_deducted = false,
      notes = CASE
        WHEN v_reason = '' THEN notes
        WHEN COALESCE(notes, '') = '' THEN '[Cancelled: ' || v_reason || ']'
        ELSE notes || ' [Cancelled: ' || v_reason || ']'
      END,
      updated_at = NOW()
  WHERE id = v_order_id;

  INSERT INTO order_status_history(order_id, previous_status, new_status, changed_by, note, created_at)
  VALUES (v_order_id, v_order.status, 'cancelled', v_actor_name, v_reason, NOW());

  INSERT INTO audit_logs(
    user_id, user_name, user_role, cashier_id, branch_id,
    action, entity, entity_id, previous_value, new_value,
    reason, financial_impact, risk_level, details, created_at
  ) VALUES (
    v_actor_id, v_actor_name, v_actor_role, v_actor_id, v_order.branch_id,
    'CANCEL_ORDER', 'Order', v_order_id::text,
    jsonb_build_object('status', v_order.status, 'inventory_deducted', v_order.inventory_deducted)::text,
    jsonb_build_object('status', 'cancelled', 'restored_item_lines', v_restored_items)::text,
    v_reason, v_order.total, 'normal',
    'Order cancellation completed atomically; stock, delivery assignment, history and audit are in the same transaction.', NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_cancelled', false,
    'order_id', v_order_id,
    'order_number', v_order.order_number,
    'status', 'cancelled',
    'restored_item_lines', v_restored_items,
    'driver_released', v_order.assigned_driver_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_order_cancellation(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_atomic_order_cancellation(JSONB) TO service_role;

ALTER TABLE order_cancellation_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_cancellation_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON order_cancellation_idempotency TO service_role;

COMMENT ON FUNCTION fn_atomic_order_cancellation(JSONB) IS 'Authoritative atomic order cancellation: state + branch inventory + driver release + history + idempotency + audit.';
