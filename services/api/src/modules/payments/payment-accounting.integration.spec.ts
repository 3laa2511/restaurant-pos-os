import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

const adminUrl = process.env.RLS_ADMIN_DATABASE_URL;
const appUrl = process.env.RLS_APP_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfConfigured = adminUrl && appUrl && adminUrl !== appUrl ? describe : describe.skip;

describeIfConfigured('PostgreSQL payment transaction integrity', () => {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const app = new Pool({ connectionString: appUrl, max: 4 });

  const ids = {
    tenant: randomUUID(),
    branch: randomUUID(),
    user: randomUUID(),
    device: randomUUID(),
    shift: randomUUID(),
    drawer: randomUUID(),
    order: randomUUID(),
    payment: randomUUID(),
  };

  async function setContext(client: PoolClient) {
    await client.query(
      `SELECT
        set_config('app.tenant_id',$1,true),
        set_config('app.branch_id',$2,true),
        set_config('app.user_id',$3,true),
        set_config('app.session_id',$4,true)`,
      [ids.tenant, ids.branch, ids.user, randomUUID()],
    );
  }

  async function cleanup() {
    await admin.query('DELETE FROM "PaymentAdjustment" WHERE "paymentId" = $1', [ids.payment]);
    await admin.query('DELETE FROM "Payment" WHERE "id" = $1', [ids.payment]);
    await admin.query('DELETE FROM "CashDrawer" WHERE "id" = $1', [ids.drawer]);
    await admin.query('DELETE FROM "Shift" WHERE "id" = $1', [ids.shift]);
    await admin.query('DELETE FROM "Order" WHERE "id" = $1', [ids.order]);
    await admin.query('DELETE FROM "Device" WHERE "id" = $1', [ids.device]);
    await admin.query('DELETE FROM "User" WHERE "id" = $1', [ids.user]);
    await admin.query('DELETE FROM "Branch" WHERE "id" = $1', [ids.branch]);
    await admin.query('DELETE FROM "Tenant" WHERE "id" = $1', [ids.tenant]);
  }

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO "Tenant" ("id","slug","name","createdAt","updatedAt")
       VALUES ($1,$2,$3,now(),now())`,
      [ids.tenant, `payment-integrity-${ids.tenant}`, 'Payment Integrity Tenant'],
    );
    await admin.query(
      `INSERT INTO "Branch" ("id","code","name","active","tenantId","createdAt","updatedAt")
       VALUES ($1,$2,$3,true,$4,now(),now())`,
      [ids.branch, `PI-${ids.branch.slice(0,8)}`, 'Payment Integrity Branch', ids.tenant],
    );
    await admin.query(
      `INSERT INTO "User" ("id","username","displayName","passwordHash","status","tenantId","branchId","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,now(),now())`,
      [ids.user, `payment-integrity-${ids.user}`, 'Payment Integrity User', 'test-hash', ids.tenant, ids.branch],
    );
    await admin.query(
      `INSERT INTO "Device" ("id","deviceCode","name","status","branchId","createdAt","updatedAt")
       VALUES ($1,$2,$3,'ACTIVE',$4,now(),now())`,
      [ids.device, `PI-${ids.device.slice(0,8)}`, 'Payment Integrity Device', ids.branch],
    );
    await admin.query(
      `INSERT INTO "Shift" ("id","branchId","userId","deviceId","status","openingCash","openedAt")
       VALUES ($1,$2,$3,$4,'OPEN',100,now())`,
      [ids.shift, ids.branch, ids.user, ids.device],
    );
    await admin.query(
      `INSERT INTO "CashDrawer" ("id","branchId","deviceId","name","active")
       VALUES ($1,$2,$3,$4,true)`,
      [ids.drawer, ids.branch, ids.device, 'Payment Integrity Drawer'],
    );
    await admin.query(
      `INSERT INTO "Order" ("id","orderNumber","source","type","status","version","branchId","createdById","total","createdAt","updatedAt")
       VALUES ($1,$2,'POS','DINE_IN','CLOSED',1,$3,$4,100,now(),now())`,
      [ids.order, `PI-${ids.order.slice(0,8)}`, ids.branch, ids.user],
    );
    await admin.query(
      `INSERT INTO "Payment" ("id","orderId","shiftId","amount","method","status","idempotencyKey","createdAt","updatedAt")
       VALUES ($1,$2,$3,100,'CASH','PAID',$4,now(),now())`,
      [ids.payment, ids.order, ids.shift, `pi-${ids.payment}`],
    );
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([app.end(), admin.end()]);
  });

  it('rolls back payment mutation, refund row, and drawer movement as one unit', async () => {
    const client = await app.connect();
    const adjustmentId = randomUUID();
    const movementId = randomUUID();

    try {
      await client.query('BEGIN');
      await setContext(client);

      await client.query(
        `INSERT INTO "PaymentAdjustment"
         ("id","paymentId","orderId","shiftId","type","amount","reason","actorUserId","deviceId","idempotencyKey","operationId")
         VALUES ($1,$2,$3,$4,'REFUND',40,'forced rollback',$5,$6,$7,$8)`,
        [adjustmentId, ids.payment, ids.order, ids.shift, ids.user, ids.device, `rollback-${adjustmentId}`, `operation-${adjustmentId}`],
      );
      await client.query(
        `UPDATE "Payment" SET "status" = 'PARTIALLY_REFUNDED' WHERE "id" = $1`,
        [ids.payment],
      );
      await client.query(
        `INSERT INTO "CashDrawerMovement"
         ("id","drawerId","branchId","deviceId","shiftId","userId","type","direction","amount","reason","sourceType","sourceId","idempotencyKey","operationId","metadata","occurredAt")
         VALUES ($1,$2,$3,$4,$5,$6,'REFUND','OUT',40,'forced rollback','PAYMENT_ADJUSTMENT',$7,$8,$9,'{}',now())`,
        [movementId, ids.drawer, ids.branch, ids.device, ids.shift, ids.user, adjustmentId, `movement-${movementId}`, `operation-${adjustmentId}:refund`],
      );

      await expect(client.query('SELECT 1 / 0')).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const check = await admin.query(
      `SELECT
        (SELECT count(*) FROM "PaymentAdjustment" WHERE "id" = $1) AS adjustments,
        (SELECT count(*) FROM "CashDrawerMovement" WHERE "id" = $2) AS movements,
        (SELECT "status" FROM "Payment" WHERE "id" = $3) AS payment_status`,
      [adjustmentId, movementId, ids.payment],
    );

    expect(check.rows[0]).toEqual({
      adjustments: '0',
      movements: '0',
      payment_status: 'PAID',
    });
  });

  it('enforces a single winner for concurrent duplicate adjustment idempotency keys', async () => {
    const key = `concurrent-${randomUUID()}`;
    const clients = [await app.connect(), await app.connect()];
    const adjustmentIds = [randomUUID(), randomUUID()];
    const outcomes: string[] = [];

    try {
      await Promise.all(clients.map(async (client, index) => {
        await client.query('BEGIN');
        await setContext(client);
        try {
          await client.query(
            `INSERT INTO "PaymentAdjustment"
             ("id","paymentId","orderId","shiftId","type","amount","reason","actorUserId","deviceId","idempotencyKey","operationId")
             VALUES ($1,$2,$3,$4,'REFUND',10,'concurrent duplicate',$5,$6,$7,$8)`,
            [adjustmentIds[index], ids.payment, ids.order, ids.shift, ids.user, ids.device, key, `operation-${adjustmentIds[index]}`],
          );
          await client.query('COMMIT');
          outcomes[index] = 'committed';
        } catch (error) {
          await client.query('ROLLBACK');
          outcomes[index] = error instanceof Error ? error.message : String(error);
        } finally {
          client.release();
        }
      }));

      expect(outcomes.filter((value) => value === 'committed')).toHaveLength(1);

      const result = await admin.query(
        `SELECT count(*)::int AS count
         FROM "PaymentAdjustment"
         WHERE "paymentId" = $1 AND "idempotencyKey" = $2`,
        [ids.payment, key],
      );
      expect(result.rows[0].count).toBe(1);
    } finally {
      await admin.query('DELETE FROM "PaymentAdjustment" WHERE "idempotencyKey" = $1', [key]);
    }
  });
});
