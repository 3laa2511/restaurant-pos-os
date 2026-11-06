import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import pg from 'pg';

const { Pool } = pg;
const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const PASSWORD_PREFIX = 'scrypt-v1';

function ask(rl, label, fallback) {
  return rl.question(fallback ? `${label} [${fallback}]: ` : `${label}: `).then((value) => value.trim() || fallback);
}

async function readSecret(label) {
  if (process.env.BOOTSTRAP_OWNER_PASSWORD) return process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Set BOOTSTRAP_OWNER_PASSWORD in the environment when running without an interactive terminal.');
  }

  process.stdout.write(label);
  return new Promise((resolveSecret, reject) => {
    const stdin = process.stdin;
    let value = '';
    const previousRaw = stdin.isRaw;
    const finish = (error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(previousRaw ?? false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolveSecret(value);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') return finish(new Error('Bootstrap cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') value += character;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function hashPassword(password) {
  if (password.length < 12) throw new Error('Owner password must contain at least 12 characters.');
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${PASSWORD_PREFIX}$${KEY_LENGTH}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy services/api/.env.example to services/api/.env first.');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const tenantName = await ask(rl, 'Company / tenant name', 'Restaurant Local');
  const tenantSlug = await ask(rl, 'Tenant slug (lowercase, unique)', 'restaurant-local');
  const branchName = await ask(rl, 'Main branch name', 'Main Branch');
  const branchCode = await ask(rl, 'Main branch code', 'BR01');
  const username = await ask(rl, 'Owner username', 'owner');
  const displayName = await ask(rl, 'Owner display name', 'System Owner');
  const deviceCode = await ask(rl, 'POS device code', 'POS-01');
  rl.close();

  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenantSlug)) throw new Error('Tenant slug must be 2–63 lowercase letters, digits, or hyphens.');
  if (!/^[A-Za-z0-9._@-]{1,64}$/.test(username)) throw new Error('Owner username contains unsupported characters.');
  if (!branchCode || !deviceCode) throw new Error('Branch code and device code are required.');

  const password = await readSecret('Owner password (minimum 12 characters): ');
  const passwordHash = await hashPassword(password);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  try {
    const client = await pool.connect();
    let tenantId;
    let branchId;
    try {
      await client.query('BEGIN');

      const tenant = await client.query('SELECT "id" FROM "Tenant" WHERE "slug" = $1 FOR UPDATE', [tenantSlug]);
      tenantId = tenant.rows[0]?.id;
      if (!tenantId) {
        tenantId = randomUUID();
        await client.query(
          'INSERT INTO "Tenant" ("id","slug","name","active","currency","createdAt","updatedAt") VALUES ($1,$2,$3,true,\'EGP\',now(),now())',
          [tenantId, tenantSlug, tenantName],
        );
      }

      const branch = await client.query(
        'SELECT "id" FROM "Branch" WHERE "tenantId" = $1 AND "code" = $2',
        [tenantId, branchCode],
      );
      branchId = branch.rows[0]?.id;
      if (!branchId) {
        branchId = randomUUID();
        await client.query(
          'INSERT INTO "Branch" ("id","code","name","active","tenantId","createdAt","updatedAt") VALUES ($1,$2,$3,true,$4,now(),now())',
          [branchId, branchCode, branchName, tenantId],
        );
      }

      const existingUser = await client.query('SELECT "id" FROM "User" WHERE "username" = $1', [username]);
      if (existingUser.rowCount) {
        throw new Error(`Username "${username}" already exists. Bootstrap will not overwrite an existing account or password.`);
      }

      const role = await client.query(
        'INSERT INTO "Role" ("id","code","name") VALUES ($1,\'OWNER\',\'Owner\') ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name" RETURNING "id"',
        [randomUUID()],
      );
      const userId = randomUUID();
      await client.query(
        'INSERT INTO "User" ("id","username","displayName","passwordHash","status","tenantId","branchId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,\'ACTIVE\',$5,NULL,now(),now())',
        [userId, username, displayName, passwordHash, tenantId],
      );
      await client.query(
        'INSERT INTO "UserRole" ("userId","roleId") VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, role.rows[0].id],
      );

      const existingDevice = await client.query('SELECT "id","branchId","status" FROM "Device" WHERE "deviceCode" = $1', [deviceCode]);
      if (existingDevice.rowCount) {
        const device = existingDevice.rows[0];
        if (device.branchId !== branchId || device.status !== 'ACTIVE') {
          throw new Error(`Device "${deviceCode}" already exists but is not active on the selected branch.`);
        }
      } else {
        await client.query(
          'INSERT INTO "Device" ("id","deviceCode","name","status","branchId","createdAt","updatedAt") VALUES ($1,$2,$3,\'ACTIVE\',$4,now(),now())',
          [randomUUID(), deviceCode, deviceCode, branchId],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const appEnvPath = resolve(dirname(new URL(import.meta.url).pathname), '../../../apps/pos-desktop/.env.local');
    mkdirSync(dirname(appEnvPath), { recursive: true });
    writeFileSync(appEnvPath, `VITE_API_URL=http://localhost:3000\nVITE_BRANCH_ID=${branchId}\nVITE_DEVICE_CODE=${deviceCode}\n`, { encoding: 'utf8', mode: 0o600 });

    process.stdout.write([
      '',
      'Local owner bootstrap completed.',
      `Tenant: ${tenantName} (${tenantSlug})`,
      `Branch ID: ${branchId}`,
      `Device code: ${deviceCode}`,
      `Owner username: ${username}`,
      'Password: the password you entered (not stored in this script or printed).',
      `Desktop settings written to: ${appEnvPath}`,
      '',
      'Start the API and desktop app, then sign in to the POS workspace.',
    ].join('\n'));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Local bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
