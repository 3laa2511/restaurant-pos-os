import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';

type Fixture = {
  branchId: string;
  shiftId: string;
  cashierId: string;
  productId: string;
  productPrice: number;
};

const databaseUrl = process.env.STAGING_DATABASE_URL ?? process.env.DATABASE_URL;

const shouldRun = Boolean(databaseUrl);

describe('POS staging integration matrix', () => {
  const pool = shouldRun
    ? new Pool({
        connectionString: databaseUrl,
        max: 4,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      })
    : null;

  let fixture: Fixture;

  beforeAll(async () => {
    if (!pool) return;

    const result = await pool.query<{
      branch_id: string;
      shift_id: string;
      cashier_id: string;
      product_id: string;
      price: string;
    }>(`
      SELECT
        s.branch_id,
        s.id AS shift_id,
        s.cashier_id,
        p.id AS product_id,
        p.price::text AS price
      FROM public.cash_drawer_shifts s
      CROSS JOIN LATERAL (
        SELECT id, price
        FROM public.products
        WHERE COALESCE(stock_quantity, 0) > 0
        ORDER BY updated_at DESC NULLS LAST, id
        LIMIT 1
      ) p
      WHERE s.status = 'open'
      ORDER BY s.opened_at DESC NULLS LAST
      LIMIT 1
    `);

    if (result.rowCount !== 1) {
      throw new Error('STAGING_FIXTURE_MISSING: requires one open shift and one in-stock product');
    }

    const row = result.rows[0];
    fixture = {
      branchId: row.branch_id,
      shiftId: row.shift_id,
      cashierId: row.cashier_id,
      productId: row.product_id,
      productPrice: Number(row.price),
    };
  });

  afterAll(async () => {
    await pool?.end();
  });

  const withRollback = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    if (!pool) throw new Error('STAGING_DATABASE_URL/DATABASE_URL is not configured');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  const checkout = (client: PoolClient, orderNumber: string, overrides: Record<string, unknown> = {}) =>
    client.query<{ result: Record<string, unknown> }>(
      'SELECT public.fn_atomic_pos_checkout($1::jsonb) AS result',
      [
        JSON.stringify({
          order_number: orderNumber,
          source: 'pos_cashier',
          branch_id: fixture.branchId,
          cashier_id: fixture.cashierId,
          shift_id: fixture.shiftId,
          cashier_name: 'Staging Integration',
          cashier_role: 'cashier',
          payment_method: 'pos_cash',
          cash_tendered: fixture.productPrice,
          items: [{ product_id: fixture.productId, quantity: 1 }],
          ...overrides,
        }),
      ],
    );

  it('cash checkout persists authoritative totals before payment settlement', async () => {
    if (!pool) return;
    await withRollback(async client => {
      const { rows } = await checkout(client, `IT-CASH-${Date.now()}`);
      expect(rows[0].result).toMatchObject({ success: true, existing: false, payment_status: 'paid' });

      const order = await client.query(
        'SELECT total, payment_status FROM public.orders WHERE id = $1::uuid',
        [rows[0].result.order_id],
      );
      expect(Number(order.rows[0].total)).toBeCloseTo(fixture.productPrice, 2);
      expect(order.rows[0].payment_status).toBe('paid');
    });
  });

  it('same order_number is idempotent inside a retry', async () => {
    if (!pool) return;
    await withRollback(async client => {
      const orderNumber = `IT-IDEMP-${Date.now()}`;
      const first = await checkout(client, orderNumber);
      const second = await checkout(client, orderNumber);

      expect(first.rows[0].result.existing).toBe(false);
      expect(second.rows[0].result.existing).toBe(true);
      expect(second.rows[0].result.order_id).toBe(first.rows[0].result.order_id);

      const count = await client.query(
        'SELECT COUNT(*)::int AS count FROM public.orders WHERE order_number = $1',
        [orderNumber],
      );
      expect(count.rows[0].count).toBe(1);
    });
  });

  it('rejects insufficient cash without persisting an order', async () => {
    if (!pool) return;
    await withRollback(async client => {
      const orderNumber = `IT-UNDERPAY-${Date.now()}`;
      await expect(
        checkout(client, orderNumber, { cash_tendered: Math.max(0, fixture.productPrice - 0.01) }),
      ).rejects.toThrow(/ERR_INSUFFICIENT_TENDER/);

      const count = await client.query(
        'SELECT COUNT(*)::int AS count FROM public.orders WHERE order_number = $1',
        [orderNumber],
      );
      expect(count.rows[0].count).toBe(0);
    });
  });

  it('settles card, wallet, instapay and mixed tenders with authoritative breakdowns', async () => {
    if (!pool) return;
    await withRollback(async client => {
      const methods = [
        { method: 'card', card_amount: fixture.productPrice },
        { method: 'wallet', wallet_amount: fixture.productPrice },
        { method: 'instapay', wallet_amount: fixture.productPrice },
        { method: 'mixed', cash_amount: fixture.productPrice / 2, card_amount: fixture.productPrice / 2, cash_tendered: fixture.productPrice / 2 + 5 },
      ];

      for (const [index, payment] of methods.entries()) {
        const orderNumber = `IT-TENDER-${Date.now()}-${index}`;
        const { rows } = await checkout(client, orderNumber, {
          payment_method: payment.method,
          cash_tendered: payment.method === 'mixed' ? payment.cash_tendered : 0,
          cash_amount: payment.cash_amount ?? 0,
          card_amount: payment.card_amount ?? 0,
          wallet_amount: payment.wallet_amount ?? 0,
        });

        expect(rows[0].result).toMatchObject({ success: true, payment_status: 'paid' });

        const paymentRow = await client.query(
          `SELECT method, amount, cash_amount, card_amount, wallet_amount, cash_tendered, change_amount
           FROM public.payments WHERE order_id = $1::uuid`,
          [rows[0].result.order_id],
        );

        expect(paymentRow.rowCount).toBe(1);
        expect(paymentRow.rows[0].method).toBe(payment.method);
        expect(Number(paymentRow.rows[0].amount)).toBeCloseTo(fixture.productPrice, 2);
      }
    });
  });

  it('rejects oversettlement against an already fully paid order', async () => {
    if (!pool) return;
    await withRollback(async client => {
      const orderNumber = `IT-OVERSETTLE-${Date.now()}`;
      const first = await checkout(client, orderNumber);
      expect(first.rows[0].result.payment_status).toBe('paid');

      await expect(
        client.query(
          `INSERT INTO public.payments
             (order_id, amount, method, status, transaction_ref, paid_at,
              cash_amount, cash_tendered, change_amount, shift_id, branch_id, cashier_id)
           VALUES ($1::uuid, $2, 'pos_cash', 'paid', $3, NOW(), $2, $2, 0,
                   $4::uuid, $5::uuid, $6::uuid)`,
          [
            first.rows[0].result.order_id,
            fixture.productPrice,
            `IT-OVERSETTLE-TXN-${Date.now()}`,
            fixture.shiftId,
            fixture.branchId,
            fixture.cashierId,
          ],
        ),
      ).rejects.toThrow(/ERR_PAYMENT_OVERSETTLEMENT/);
    });
  });

  it('executes partial refund, restores inventory, and is idempotent', async () => {
    if (!pool) return;
    await withRollback(async client => {
      const orderNumber = `IT-PARTIAL-REFUND-${Date.now()}`;
      const checkoutResult = await checkout(client, orderNumber);
      const orderId = checkoutResult.rows[0].result.order_id as string;

      const item = await client.query(
        'SELECT id, quantity FROM public.order_items WHERE order_id = $1::uuid LIMIT 1',
        [orderId],
      );
      expect(item.rowCount).toBe(1);

      const beforeStock = await client.query(
        'SELECT stock_quantity FROM public.products WHERE id = $1::uuid',
        [fixture.productId],
      );

      const key = `IT-REFUND-${Date.now()}`;
      const payload = {
        order_id: orderId,
        branch_id: fixture.branchId,
        cashier_id: fixture.cashierId,
        shift_id: fixture.shiftId,
        idempotency_key: key,
        reason: 'Automated integration refund',
        refund_items: [{ order_item_id: item.rows[0].id, quantity: 1 }],
      };

      const first = await client.query(
        'SELECT public.fn_atomic_pos_partial_refund($1::jsonb) AS result',
        [JSON.stringify(payload)],
      );

      expect(first.rows[0].result).toMatchObject({ success: true, existing: false, partial: true });

      const afterStock = await client.query(
        'SELECT stock_quantity FROM public.products WHERE id = $1::uuid',
        [fixture.productId],
      );
      expect(Number(afterStock.rows[0].stock_quantity)).toBe(Number(beforeStock.rows[0].stock_quantity) + 1);

      const second = await client.query(
        'SELECT public.fn_atomic_pos_partial_refund($1::jsonb) AS result',
        [JSON.stringify(payload)],
      );
      expect(second.rows[0].result.existing).toBe(true);
      expect(second.rows[0].result.refund_id).toBe(first.rows[0].result.refund_id);
    });
  });

  it('rejects refund of the same quantity twice', async () => {
    if (!pool) return;
    await withRollback(async client => {
      const orderNumber = `IT-REFUND-DOUBLE-${Date.now()}`;
      const checkoutResult = await checkout(client, orderNumber);
      const orderId = checkoutResult.rows[0].result.order_id as string;

      const item = await client.query(
        'SELECT id FROM public.order_items WHERE order_id = $1::uuid LIMIT 1',
        [orderId],
      );

      const base = {
        order_id: orderId,
        branch_id: fixture.branchId,
        cashier_id: fixture.cashierId,
        shift_id: fixture.shiftId,
        reason: 'Automated integration refund',
        refund_items: [{ order_item_id: item.rows[0].id, quantity: 1 }],
      };

      await client.query(
        'SELECT public.fn_atomic_pos_partial_refund($1::jsonb)',
        [JSON.stringify({ ...base, idempotency_key: `IT-REFUND-A-${Date.now()}` })],
      );

      await expect(
        client.query(
          'SELECT public.fn_atomic_pos_partial_refund($1::jsonb)',
          [JSON.stringify({ ...base, idempotency_key: `IT-REFUND-B-${Date.now()}` })],
        ),
      ).rejects.toThrow(/ERR_REFUND_QUANTITY_EXCEEDED|ERR_ALREADY_REFUNDED|ERR_REFUND_LIMIT_EXCEEDED/);
    });
  });

  it('rejects a cashier/shift mismatch authoritatively', async () => {
    if (!pool) return;
    await withRollback(async client => {
      const orderNumber = `IT-WRONG-CASHIER-${Date.now()}`;
      await expect(
        checkout(client, orderNumber, {
          cashier_id: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow(/ERR_SHIFT_REQUIRED|ERR_POS_SHIFT/);
    });
  });

  it('rejects a closed/nonexistent shift authoritatively', async () => {
    if (!pool) return;
    await withRollback(async client => {
      const orderNumber = `IT-CLOSED-SHIFT-${Date.now()}`;
      await expect(
        checkout(client, orderNumber, {
          shift_id: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow(/ERR_SHIFT_REQUIRED|ERR_POS_SHIFT_NOT_OPEN/);
    });
  });
});
