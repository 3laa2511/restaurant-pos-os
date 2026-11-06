import { Prisma } from '../generated/prisma/client.js';
import type { AuthContext } from '../modules/auth/authorization.types.js';

export const RLS_TENANT_SETTING = 'app.tenant_id';
export const RLS_BRANCH_SETTING = 'app.branch_id';
export const RLS_USER_SETTING = 'app.user_id';
export const RLS_SESSION_SETTING = 'app.session_id';
export const RLS_PROVIDER_ENDPOINT_HASH_SETTING = 'app.provider_endpoint_hash';
export const RLS_PROVIDER_ACCOUNT_ID_SETTING = 'app.provider_account_id';

export type RlsTransaction = Prisma.TransactionClient;

function requireScopeValue(value: string | null | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`RLS ${field} is required`);
  }
  return value.trim();
}

/**
 * Sets request security context on the transaction-local PostgreSQL session.
 *
 * IMPORTANT: the third argument to set_config is TRUE. This makes the values
 * disappear automatically when the transaction ends, so a pooled connection
 * can safely serve another tenant afterward.
 */
export async function setRlsContext(
  tx: RlsTransaction,
  context: Pick<AuthContext, 'tenantId' | 'branchId' | 'userId' | 'sessionId'>,
): Promise<void> {
  const tenantId = requireScopeValue(context.tenantId, 'tenantId');
  const userId = requireScopeValue(context.userId, 'userId');
  const sessionId = requireScopeValue(context.sessionId, 'sessionId');
  const branchId = context.branchId?.trim() || '';

  await tx.$executeRaw`
    SELECT
      set_config(${RLS_TENANT_SETTING}, ${tenantId}, true),
      set_config(${RLS_BRANCH_SETTING}, ${branchId}, true),
      set_config(${RLS_USER_SETTING}, ${userId}, true),
      set_config(${RLS_SESSION_SETTING}, ${sessionId}, true)
  `;
}

export async function withRlsContext<T>(
  prisma: PrismaServiceLike,
  context: Pick<AuthContext, 'tenantId' | 'branchId' | 'userId' | 'sessionId'>,
  work: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, context);
    return work(tx);
  });
}

export async function setLoginRlsContext(
  tx: RlsTransaction,
  username: string,
): Promise<void> {
  const normalized = username.trim();
  if (!normalized) throw new Error('RLS login username is required');

  await tx.$executeRaw`
    SELECT set_config('app.login_username', ${normalized}, true)
  `;
}

export async function withLoginRlsContext<T>(
  prisma: PrismaServiceLike,
  username: string,
  work: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setLoginRlsContext(tx, username);
    return work(tx);
  });
}

/**
 * Allows one lookup of an active provider account by the SHA-256 hash of its
 * high-entropy webhook endpoint key. Call only before signature verification;
 * this context does not grant access to payment intents or event rows.
 */
export async function withProviderEndpointBootstrapRlsContext<T>(
  prisma: PrismaServiceLike,
  endpointKeyHash: string,
  work: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  if (!/^[a-f0-9]{64}$/.test(endpointKeyHash)) {
    throw new Error('RLS provider endpoint hash must be a SHA-256 hex digest');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config(${RLS_PROVIDER_ENDPOINT_HASH_SETTING}, ${endpointKeyHash}, true)
    `;
    return work(tx);
  });
}

/**
 * Restricts provider webhook processing to one previously resolved provider
 * account. Never derive this ID from the untrusted provider event body.
 */
export async function withProviderAccountRlsContext<T>(
  prisma: PrismaServiceLike,
  providerAccountId: string,
  work: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const scopedAccountId = requireScopeValue(providerAccountId, 'providerAccountId');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config(${RLS_PROVIDER_ACCOUNT_ID_SETTING}, ${scopedAccountId}, true)
    `;
    return work(tx);
  });
}

export async function withSessionBootstrapRlsContext<T>(
  prisma: PrismaServiceLike,
  tokenHash: string,
  work: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  if (!tokenHash) throw new Error('RLS session token hash is required');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.session_token_hash', ${tokenHash}, true)
    `;
    return work(tx);
  });
}

export interface PrismaServiceLike {
  $transaction<T>(
    fn: (tx: RlsTransaction) => Promise<T>,
  ): Promise<T>;
}
