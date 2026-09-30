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
  };

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO "Tenant" ("id","slug","name") VALUES ($1,$2,$3),($4,$5,$6)`,
      [ids.tenantA, `rls-a-${ids.tenantA}`, 'RLS Tenant A', ids.tenantB, `rls-b-${ids.tenantB}`, 'RLS Tenant B'],
    );
    await admin.query(
      `INSERT INTO "Branch" ("id","code","name","active","tenantId","createdAt","updatedAt")
       VALUES ($1,'A-1','Branch A',true,$4,now(),now()),
              ($2,'A-2','Branch A2',true,$4,now(),now()),
              ($3,'B-1','Branch B',true,$5,now(),now())`,
      [ids.branchA, ids.branchB, ids.branchC, ids.tenantA, ids.tenantB],
    );
  });

  afterAll(async () => {
    await admin.query('DELETE FROM "Branch" WHERE "id" IN ($1,$2,$3)', [ids.branchA, ids.branchB, ids.branchC]);
    await admin.query('DELETE FROM "Tenant" WHERE "id" IN ($1,$2)', [ids.tenantA, ids.tenantB]);
    await Promise.all([app.end(), admin.end()]);
  });

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
          set_config('app.branch_id,$2,true),
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

  it('denies cross-tenant insert and tenant-moving update', async () => {
    await inContext(ids.tenantA, ids.branchA, async (client) => {
      await expect(client.query(
        `INSERT INTO "Branch" ("id","code","name","active","tenantId","createdAt","updatedAt")
         VALUES ($1,'ILLEGAL','Illegal',true,$2,now(),now())`,
        [randomUUID(), ids.tenantB],
      )).rejects.toThrow();

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
