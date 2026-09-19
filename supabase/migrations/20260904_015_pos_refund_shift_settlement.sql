-- ==============================================================================
-- BO'SH STORE — ATOMIC POS REFUND + INVENTORY + CASH DRAWER SETTLEMENT
-- Migration: 20260904_015_pos_refund_shift_settlement
-- Purpose: one server-authoritative transaction for POS refunds.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_atomic_pos_refund(
  p_order_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID,
  p_shift_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders;
  v_payment payments;
  v_shift cash_drawer_shifts;
  v_item RECORD;
  v_product products;
  v_refund NUMERIC(12,2);
  v_cash_refund NUMERIC(12,2);
  v_non_cash_refund NUMERIC(12,2);
  v_reason TEXT;
  v_movement_id UUID;
  v_refund_items INT := 0;
  v_cashier_name TEXT;
  v_cashier_role TEXT;
BEGIN
  IF p_order_id IS NULL OR p_branch_id IS NULL OR p_cashier_id IS NULL OR p_shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_CONTEXT_REQUIRED: Order, branch, cashier and shift are required';
  END IF;

  v_reason := COALESCE(NULLIF(TRIM(p_reason), ''), 'POS order refund');

  -- Lock the active drawer. Refunds are accountable to the cashier performing
  -- them, even when the original sale belongs to an earlier shift.
  SELECT * INTO v_shift
  FROM cash_drawer_shifts
  WHERE id = p_shift_id
    AND branch_id = p_branch_id
    AND cashier_id = p_cashier_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SHIFT_REQUIRED: An open cash drawer shift is required for POS refund';
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
    AND branch_id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REFUND_ORDER_NOT_FOUND: POS order was not found in this branch';
  END IF;

  IF v_order.source NOT IN ('pos_cashier', 'pos_store') THEN
    RAISE EXCEPTION 'ERR_POS_REFUND_REQUIRED: Only POS orders can use the POS refund settlement path';
  END IF;

  IF v_order.status = 'returned' OR v_order.payment_status = 'refunded' THEN
    RAISE EXCEPTION 'ERR_ALREADY_REFUNDED: This order has already been refunded';
  END IF;

  SELECT * INTO v_payment
  FROM payments
  WHERE order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REFUND_PAYMENT_NOT_FOUND: A payment record is required before refunding';
  END IF;

  IF v_payment.status = 'refunded' THEN
    RAISE EXCEPTION 'ERR_ALREADY_REFUNDED: This payment has already been refunded';
  END IF;

  IF v_payment.status <> 'paid' THEN
    RAISE EXCEPTION 'ERR_REFUND_PAYMENT_NOT_SETTLED: Only a paid POS payment can be refunded';
  END IF;

  IF v_payment.shift_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REFUND_SHIFT_BINDING_MISSING: POS payment is missing its cash drawer shift binding';
  END IF;

  v_refund := ROUND(COALESCE(v_payment.paid_amount, v_payment.amount, 0), 2);
  v_cash_refund := ROUND(COALESCE(v_payment.cash_amount, 0), 2);
  v_non_cash_refund := ROUND(v_refund - v_cash_refund, 2);

  IF v_refund <= 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_REFUND_AMOUNT: Authoritative payment amount must be greater than zero';
  END IF;

  IF v_cash_refund > v_shift.expected_cash THEN
    RAISE EXCEPTION 'ERR_INSUFFICIENT_DRAWER_CASH: Drawer does not contain enough expected cash for this refund';
  END IF;

  -- Restore inventory and serialized-device state in the same transaction as
  -- the financial refund. Client-supplied quantities/prices are never trusted.
  IF v_order.inventory_deducted THEN
    FOR v_item IN
      SELECT product_id, product_name, sku, quantity, serial_number, total
      FROM order_items
      WHERE order_id = p_order_id
        AND product_id IS NOT NULL
      ORDER BY id
    LOOP
      SELECT * INTO v_product
      FROM products
      WHERE id = v_item.product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_REFUND_PRODUCT_NOT_FOUND: Product % no longer exists', v_item.product_id;
      END IF;

      INSERT INTO inventory_movements(
        product_id, product_name, sku, type, quantity,
        previous_quantity, resulting_quantity, reason,
        reference_type, reference_id, performed_by
      ) VALUES (
        v_product.id,
        v_product.name,
        v_product.sku,
        'return',
        v_item.quantity,
        v_product.stock_quantity,
        v_product.stock_quantity + v_item.quantity,
        v_reason,
        'return',
        p_order_id::TEXT,
        COALESCE(NULLIF(TRIM(v_order.cashier_name), ''), 'POS Refund')
      );

      UPDATE products
      SET stock_quantity = stock_quantity + v_item.quantity,
          updated_at = NOW()
      WHERE id = v_product.id;

      IF NULLIF(TRIM(COALESCE(v_item.serial_number, '')), '') IS NOT NULL THEN
        UPDATE serialized_devices
        SET status = 'returned',
            updated_at = NOW()
        WHERE serial_number = TRIM(v_item.serial_number)
          AND order_id = p_order_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'ERR_REFUND_SERIAL_NOT_FOUND: Serialized device % is not linked to this order', v_item.serial_number;
        END IF;
      END IF;

      v_refund_items := v_refund_items + 1;
    END LOOP;

    UPDATE orders
    SET inventory_deducted = false,
        updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  IF v_cash_refund > 0 THEN
    INSERT INTO cash_drawer_movements(
      shift_id, branch_id, cashier_id, type, amount,
      reason, reference_type, reference_id
    ) VALUES (
      p_shift_id, p_branch_id, p_cashier_id, 'refund_cash',
      v_cash_refund, v_reason, 'order', p_order_id
    )
    RETURNING id INTO v_movement_id;

    UPDATE cash_drawer_shifts
    SET expected_cash = ROUND(expected_cash - v_cash_refund, 2),
        updated_at = NOW()
    WHERE id = p_shift_id;
  END IF;

  UPDATE payments
  SET status = 'refunded'
  WHERE id = v_payment.id;

  UPDATE orders
  SET payment_status = 'refunded',
      status = 'returned',
      updated_at = NOW()
  WHERE id = p_order_id;

  SELECT COALESCE(NULLIF(TRIM(p.name), ''), 'POS Cashier'), COALESCE(p.role::TEXT, 'cashier')
    INTO v_cashier_name, v_cashier_role
  FROM profiles p
  WHERE p.user_id = p_cashier_id OR p.id = p_cashier_id
  ORDER BY CASE WHEN p.user_id = p_cashier_id THEN 0 ELSE 1 END
  LIMIT 1;

  INSERT INTO audit_logs(
    user_id, user_name, user_role, action, entity, entity_id,
    previous_value, new_value, details
  ) VALUES (
    p_cashier_id::TEXT,
    COALESCE(v_cashier_name, 'POS Cashier'),
    COALESCE(v_cashier_role, 'cashier'),
    'REFUND_ORDER',
    'Order',
    p_order_id::TEXT,
    'payment_status=paid;status=' || v_order.status,
    'payment_status=refunded;status=returned',
    jsonb_build_object(
      'refund_amount', v_refund,
      'cash_refund_amount', v_cash_refund,
      'non_cash_refund_amount', v_non_cash_refund,
      'shift_id', p_shift_id,
      'reason', v_reason,
      'inventory_items_restored', v_refund_items
    )::TEXT
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'refund_amount', v_refund,
    'cash_refund_amount', v_cash_refund,
    'non_cash_refund_amount', v_non_cash_refund,
    'shift_id', p_shift_id,
    'cash_movement_id', v_movement_id,
    'payment_id', v_payment.id,
    'inventory_items_restored', v_refund_items
  );
END;
$$;

REVOKE ALL ON FUNCTION fn_atomic_pos_refund(UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_atomic_pos_refund(UUID,UUID,UUID,UUID,TEXT) TO service_role;
