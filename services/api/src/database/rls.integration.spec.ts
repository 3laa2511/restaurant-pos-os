import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const adminUrl = process.env.RLS_ADMIN_DATABASE_URL;
const appUrl = process.env.RLS_APP_DATABASE_URL ?? process.env.DATABASE_URL;

const describeIfConfigured = adminUrl && appUrl && adminUrl !== appUrl ? describe : describe.skip;

describeIfConfigured('PostgreSQL RLS isolation', () => {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const app = new Pool({ connectionString: appUrl, max: 2 });
  const ids = {
    tenantA: randomUUID(),
    tenantB: randomUUID(),
    branchA: randomUUID(),
    branchB: randomUUID(),
    branchC: randomUUID(),
    userA: randomUUID(),
    orderA: randomUUID(),
    providerAccountA: randomUUID(),
    paymentIntentA: randomUUID(),
    paymentAttemptA: randomUUID(),
    providerEventA: randomUUID(),
  };

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO "Tenant" ("id","slug","name","createdAt","updatedAt") VALUES ($1,$2,$3,now(),now()),($4,$5,$6,now(),now())`,
      [ids.tenantA, `rls-a-${ids.tenantA}`, 'RLS Tenant A', ids.tenantB, `rls-b-${ids.tenantB}`, 'RLS Tenant B'],
    );
    await admin.query(
      `INSERT INTO "Branch" ("id","code","name","active","tenantId","createdAt","updatedAt")
       VALUES ($1,'A-1','Branch A',true,$4,now(),now()),
              ($2,'A-2','Branch A2',true,$4,now(),now()),
              ($3,'B-1','Branch B',true,$5,now(),now())`,
      [ids.branchA, ids.branchB, ids.branchC, ids.tenantA, ids.tenantB],
    );

    await admin.query(
      `INSERT INTO "User" ("id","username","displayName","passwordHash","tenantId","createdAt","updatedAt")
       VALUES ($1,$2,'RLS User','test-hash',$3,now(),now())`,
      [ids.userA, `rls-user-${ids.userA}`, ids.tenantA],
    );
    await admin.query(
      `INSERT INTO "Order" ("id","orderNumber","source","type","branchId","createdById","total","createdAt","updatedAt")
       VALUES ($1,'RLS-ORDER','POS','TAKEAWAY',$2,$3,12.00,now(),now())`,
      [ids.orderA, ids.branchA, ids.userA],
    );
    await admin.query(
      `INSERT INTO "PaymentProviderAccount"
       ("id","tenantId","branchId","providerCode","displayName","currency","active","webhookKeyHash","createdAt","updatedAt")
       VALUES ($1,$2,$3,'TEST_PROVIDER','RLS Test Account','EGP',true,$4,now(),now())`,
      [ids.providerAccountA, ids.tenantA, ids.branchA, 'a'.repeat(64)],
    );
    await admin.query(
      `INSERT INTO "PaymentIntent"
       ("id","tenantId","branchId","orderId","providerAccountId","channel","amountMinor","currency",
        "status","merchantReference","idempotencyKey","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,'DIRECT_TRANSFER',1200,'EGP','PENDING',$6,$7,now(),now())`,
      [ids.paymentIntentA, ids.tenantA, ids.branchA, ids.orderA, ids.providerAccountA,
       `merchant-${ids.paymentIntentA}`, `intent-${ids.paymentIntentA}`],
    );
    await admin.query(
      `INSERT INTO "PaymentAttempt"
       ("id","tenantId","intentId","attemptNumber","status","startedAt","createdAt")
       VALUES ($1,$2,$3,1,'PENDING',now(),now())`,
      [ids.paymentAttemptA, ids.tenantA, ids.paymentIntentA],
    );
    await admin.query(
      `INSERT INTO "PaymentProviderEvent"
       ("id","tenantId","providerAccountId","providerEventId","payloadHash","signatureValid","status","receivedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,true,'RECEIVED',now(),now(),now())`,
      [ids.providerEventA, ids.tenantA, ids.providerAccountA, `event-${ids.providerEventA}`, 'b'.repeat(64)],
    );
  });

  afterAll(async () => {
    await admin.query('DELETE FROM "PaymentProviderEvent" WHERE "id" = $1', [ids.providerEventA]);
    await admin.query('DELETE FROM "PaymentAttempt" WHERE "id" = $1', [ids.paymentAttemptA]);
    await admin.query('DELETE FROM "PaymentIntent" WHERE "id" = $1', [ids.paymentIntentA]);
    await admin.query('DELETE FROM "PaymentProviderAccount" WHERE "id" = $1', [ids.providerAccountA]);
    await admin.query('DELETE FROM "Order" WHERE "id" = $1', [ids.orderA]);
    await admin.query('DELETE FROM "User" WHERE "id" = $1', [ids.userA]);
    await admin.query('DELETE FROM "Branch" WHERE "id" IN ($1,$2,$3)', [ids.branchA, ids.branchB, ids.branchC]);
    await admin.query('DELETE FROM "Tenant" WHERE "id" IN ($1,$2)', [ids.tenantA, ids.tenantB]);
    await Promise.all([app.end(), admin.end()]);
  });

  async function inProviderEndpointContext(
    endpointHash: string,
    work: (client: import('pg').PoolClient) => Promise<void>,
  ) {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.provider_endpoint_hash',$1,true)`, [endpointHash]);
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function inProviderAccountContext(
    providerAccountId: string,
    work: (client: import('pg').PoolClient) => Promise<void>,
  ) {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.provider_account_id',$1,true)`, [providerAccountId]);
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function inContext(
    tenantId: string,
    branchId: string | null,
    work: (client: import('pg').PoolClient) => Promise<void>,
  ) {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT
          set_config('app.tenant_id',$1,true),
          set_config('app.branch_id',$2,true),
          set_config('app.user_id',$3,true),
          set_config('app.session_id',$4,true)`,
        [tenantId, branchId ?? '', randomUUID(), randomUUID()],
      );
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  it('isolates tenant and branch reads', async () => {
    await inContext(ids.tenantA, ids.branchA, async (client) => {
      const result = await client.query(
        `SELECT "id" FROM "Branch" ORDER BY "id"`,
      );
      expect(result.rows.map((row) => row.id)).toEqual([ids.branchA]);
    });

    await inContext(ids.tenantA, null, async (client) => {
      const result = await client.query(`SELECT "id" FROM "Branch" ORDER BY "id"`);
      expect(result.rows.map((row) => row.id).sort()).toEqual([ids.branchA, ids.branchB].sort());
    });

    await inContext(ids.tenantB, ids.branchC, async (client) => {
      const result = await client.query(`SELECT "id" FROM "Branch"`);
      expect(result.rows.map((row) => row.id)).toEqual([ids.branchC]);
    });
  });

  it('isolates payment provider accounts, intents, and attempts by tenant and branch', async () => {
    await inContext(ids.tenantA, ids.branchA, async (client) => {
      const accounts = await client.query(
        `SELECT "id" FROM "PaymentProviderAccount" WHERE "id" = $1`,
        [ids.providerAccountA],
      );
      const intents = await client.query(
        `SELECT "id" FROM "PaymentIntent" WHERE "id" = $1`,
        [ids.paymentIntentA],
      );
      const attempts = await client.query(
        `SELECT "id" FROM "PaymentAttempt" WHERE "id" = $1`,
        [ids.paymentAttemptA],
      );
      expect(accounts.rows).toHaveLength(1);
      expect(intents.rows).toHaveLength(1);
      expect(attempts.rows).toHaveLength(1);
    });

    await inContext(ids.tenantA, ids.branchB, async (client) => {
      expect((await client.query(`SELECT "id" FROM "PaymentProviderAccount"`)).rows).toHaveLength(0);
      expect((await client.query(`SELECT "id" FROM "PaymentIntent"`)).rows).toHaveLength(0);
      expect((await client.query(`SELECT "id" FROM "PaymentAttempt"`)).rows).toHaveLength(0);
    });

    await inContext(ids.tenantB, ids.branchC, async (client) => {
      expect((await client.query(`SELECT "id" FROM "PaymentProviderAccount"`)).rows).toHaveLength(0);
      expect((await client.query(`SELECT "id" FROM "PaymentIntent"`)).rows).toHaveLength(0);
      expect((await client.query(`SELECT "id" FROM "PaymentAttempt"`)).rows).toHaveLength(0);
    });
  });

  it('resolves exactly one active provider account from its endpoint-key hash', async () => {
    await inProviderEndpointContext('a'.repeat(64), async (client) => {
      const result = await client.query(
        `SELECT "id","tenantId","branchId" FROM "PaymentProviderAccount"`,
      );
      expect(result.rows).toEqual([{
        id: ids.providerAccountA,
        tenantId: ids.tenantA,
        branchId: ids.branchA,
      }]);
    });

    await inProviderEndpointContext('c'.repeat(64), async (client) => {
      const result = await client.query(`SELECT "id" FROM "PaymentProviderAccount"`);
      expect(result.rows).toHaveLength(0);
    });
  });

  it('limits provider event inbox access to the resolved provider account', async () => {
    await inProviderAccountContext(ids.providerAccountA, async (client) => {
      const result = await client.query(
        `SELECT "id","providerEventId" FROM "PaymentProviderEvent"`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe(ids.providerEventA);
    });

    await inProviderAccountContext(randomUUID(), async (client) => {
      const result = await client.query(`SELECT "id" FROM "PaymentProviderEvent"`);
      expect(result.rows).toHaveLength(0);
    });
  });

  it('deduplicates provider events within the provider account', async () => {
    await expect(admin.query(
      `INSERT INTO "PaymentProviderEvent"
       ("id","tenantId","providerAccountId","providerEventId","payloadHash","signatureValid","status","receivedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,true,'RECEIVED',now(),now(),now())`,
      [randomUUID(), ids.tenantA, ids.providerAccountA, `event-${ids.providerEventA}`, 'c'.repeat(64)],
    )).rejects.toThrow();
  });

  it('rejects payment intent links that cross tenant or branch boundaries', async () => {
    await expect(admin.query(
      `INSERT INTO "PaymentIntent"
       ("id","tenantId","branchId","orderId","providerAccountId","channel","amountMinor","currency",
        "status","merchantReference","idempotencyKey","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,'DIRECT_TRANSFER',1200,'EGP','PENDING',$6,$7,now(),now())`,
      [randomUUID(), ids.tenantB, ids.branchA, ids.orderA, ids.providerAccountA,
       `invalid-${randomUUID()}`, `invalid-${randomUUID()}`],
    )).rejects.toThrow();
  });

  it('denies cross-tenant insert', async () => {
    await inContext(ids.tenantA, ids.branchA, async (client) => {
      await expect(client.query(
        `INSERT INTO "Branch" ("id","code","name","active","tenantId","createdAt","updatedAt")
         VALUES ($1,'ILLEGAL','Illegal',true,$2,now(),now())`,
        [randomUUID(), ids.tenantB],
      )).rejects.toThrow();
    });
  });

  it('denies moving an existing branch to another tenant', async () => {
    // A rejected PostgreSQL statement aborts its transaction. Keep this assertion
    // separate so later RLS checks cannot pass because the transaction was aborted.
    await inContext(ids.tenantA, ids.branchA, async (client) => {
      await expect(client.query(
        `UPDATE "Branch" SET "tenantId" = $1 WHERE "id" = $2`,
        [ids.tenantB, ids.branchA],
      )).rejects.toThrow();
    });
  });

  it('does not leak transaction-local context across pooled connections', async () => {
    await inContext(ids.tenantA, ids.branchA, async (client) => {
      const result = await client.query(`SELECT count(*)::int AS count FROM "Branch"`);
      expect(result.rows[0].count).toBe(1);
    });

    const client = await app.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`SELECT count(*)::int AS count FROM "Branch"`);
      expect(result.rows[0].count).toBe(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
