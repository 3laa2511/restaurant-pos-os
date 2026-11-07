import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

const adminUrl = process.env.RLS_ADMIN_DATABASE_URL;
const appUrl = process.env.RLS_APP_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfConfigured = adminUrl && appUrl && adminUrl !== appUrl ? describe : describe.skip;

describeIfConfigured('BusinessCycle PostgreSQL RLS and concurrency', () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 4 });

  const ids = {
    tenantA: randomUUID(),
    tenantB: randomUUID(),
    branchA: randomUUID(),
    branchB: randomUUID(),
    userA: randomUUID(),
    userB: randomUUID(),
    cycleA: randomUUID(),
    cycleB: randomUUID(),
  };

  async function setContext(client: PoolClient, tenantId: string, branchId: string) {
    await client.query(
      `SELECT
        set_config('app.tenant_id',$1,true),
        set_config('app.branch_id',$2,true),
        set_config('app.user_id',$3,true),
        set_config('app.session_id',$4,true)`,
      [tenantId, branchId, randomUUID(), randomUUID()],
    );
  }

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO "Tenant" ("id","slug","name","createdAt","updatedAt")
       VALUES ($1,$2,$3,now(),now()),($4,$5,$6,now(),now())`,
      [ids.tenantA, `bc-a-${ids.tenantA}`, 'Business Cycle Tenant A', ids.tenantB, `bc-b-${ids.tenantB}`, 'Business Cycle Tenant B'],
    );
    await admin.query(
      `INSERT INTO "Branch" ("id","code","name","active","tenantId","createdAt","updatedAt")
       VALUES ($1,'BC-A','Business Cycle A',true,$3,now(),now()),
              ($2,'BC-B','Business Cycle B',true,$4,now(),now())`,
      [ids.branchA, ids.branchB, ids.tenantA, ids.tenantB],
    );
    await admin.query(
      `INSERT INTO "User" ("id","username","displayName","passwordHash","status","tenantId","branchId","createdAt","updatedAt")
       VALUES ($1,$2,'BC User A','test-hash','ACTIVE',$3,$5,now(),now()),
              ($4,$6,'BC User B','test-hash','ACTIVE',$7,$8,now(),now())`,
      [ids.userA, `bc-user-a-${ids.userA}`, ids.tenantA, ids.userB, ids.branchA, `bc-user-b-${ids.userB}`, ids.tenantB, ids.branchB],
    );
    await admin.query(
      `INSERT INTO "BusinessCycle" ("id","tenantId","branchId","name","status","openedById","openedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,'Tenant A Cycle','OPEN',$4,now(),now(),now()),
              ($5,$6,$7,'Tenant B Cycle','OPEN',$8,now(),now(),now())`,
      [ids.cycleA, ids.tenantA, ids.branchA, ids.userA, ids.cycleB, ids.tenantB, ids.branchB, ids.userB],
    );
  });

  afterAll(async () => {
    await admin.query('DELETE FROM "BusinessCycle" WHERE "tenantId" IN ($1,$2)', [ids.tenantA, ids.tenantB]);
    await admin.query('DELETE FROM "User" WHERE "id" IN ($1,$2)', [ids.userA, ids.userB]);
    await admin.query('DELETE FROM "Branch" WHERE "id" IN ($1,$2)', [ids.branchA, ids.branchB]);
    await admin.query('DELETE FROM "Tenant" WHERE "id" IN ($1,$2)', [ids.tenantA, ids.tenantB]);
    await Promise.all([app.end(), admin.end()]);
  });

  it('isolates business cycles by tenant and branch', async () => {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await setContext(client, ids.tenantA, ids.branchA);
      const visible = await client.query(
        `SELECT "id" FROM "BusinessCycle" ORDER BY "id"`,
      );
      expect(visible.rows.map((row) => row.id)).toEqual([ids.cycleA]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('denies a cross-tenant business-cycle insert under RLS', async () => {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await setContext(client, ids.tenantA, ids.branchA);
      await expect(client.query(
        `INSERT INTO "BusinessCycle"
         ("id","tenantId","branchId","name","status","openedById","openedAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,'Illegal','OPEN',$4,now(),now(),now())`,
        [randomUUID(), ids.tenantB, ids.branchB, ids.userB],
      )).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('allows only one concurrent OPEN cycle for the same tenant and branch', async () => {
    await admin.query('DELETE FROM "BusinessCycle" WHERE "tenantId" = $1 AND "branchId" = $2', [ids.tenantA, ids.branchA]);

    const attempts = [randomUUID(), randomUUID()].map(async (cycleId) => {
      const client = await app.connect();
      try {
        await client.query('BEGIN');
        await setContext(client, ids.tenantA, ids.branchA);
        try {
          await client.query(
            `INSERT INTO "BusinessCycle"
             ("id","tenantId","branchId","name","status","openedById","openedAt","createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,'OPEN',$5,now(),now(),now())`,
            [cycleId, ids.tenantA, ids.branchA, `Concurrent ${cycleId}`, ids.userA],
          );
          await client.query('COMMIT');
          return 'committed';
        } catch (error) {
          await client.query('ROLLBACK');
          return error instanceof Error ? error.message : String(error);
        }
      } finally {
        client.release();
      }
    });

    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((value) => value === 'committed')).toHaveLength(1);

    const check = await admin.query(
      `SELECT count(*)::int AS count
       FROM "BusinessCycle"
       WHERE "tenantId" = $1 AND "branchId" = $2 AND "status" = 'OPEN'`,
      [ids.tenantA, ids.branchA],
    );
    expect(check.rows[0].count).toBe(1);
  });
});
