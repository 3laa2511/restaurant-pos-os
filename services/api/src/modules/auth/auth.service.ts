import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { permissionsForRole } from './authorization.rules.js';
import { buildAuthContext } from './session.types.js';
import { workspacesForAccess } from './workspace.constants.js';
import type { WorkspaceCode } from './workspace.constants.js';
import type { AuthContext } from './authorization.types.js';
import type { KitchenStation } from '../../generated/prisma/enums.js';
import type { RoleCode } from './rbac.constants.js';

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT_KEY_LENGTH = 64;
const PASSWORD_PREFIX = 'scrypt-v1';

export interface LoginInput {
  username: string;
  password: string;
  workspace?: WorkspaceCode;
  branchId?: string;
  deviceCode?: string;
}

export interface LoginResult {
  accessToken: string;
  expiresAt: string;
  workspace: WorkspaceCode;
  availableWorkspaces: readonly WorkspaceCode[];
  user: {
    id: string;
    username: string;
    displayName: string;
    branchId: string | null;
    kitchenStation: KitchenStation | null;
    roles: readonly RoleCode[];
    permissions: readonly string[];
  };
  deviceId: string | null;
}

export interface AuthenticatedRequest {
  authContext?: AuthContext;
  sessionId?: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [prefix, cost, salt, encodedHash] = encoded.split('$');
  if (prefix !== PASSWORD_PREFIX || !cost || !salt || !encodedHash) return false;
  const keyLength = Number(cost);
  if (!Number.isInteger(keyLength) || keyLength !== SCRYPT_KEY_LENGTH) return false;
  try {
    const derived = (await scrypt(password, Buffer.from(salt, 'base64url'), keyLength)) as Buffer;
    const expected = Buffer.from(encodedHash, 'base64url');
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) throw new Error('Password must contain at least 8 characters');
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `${PASSWORD_PREFIX}$${SCRYPT_KEY_LENGTH}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const username = input.username.trim();
    if (!username || !input.password) throw new UnauthorizedException('Invalid credentials');

    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { roleLinks: { include: { role: { select: { code: true } } } } },
    });

    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.branchId !== null && input.branchId !== undefined && input.branchId !== user.branchId) {
      throw new UnauthorizedException('User is not assigned to this branch');
    }

    let selectedBranchId = user.branchId;
    let deviceId: string | null = null;

    if (input.branchId !== undefined) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: input.branchId },
        select: { id: true, active: true },
      });
      if (!branch?.active) throw new UnauthorizedException('Branch is unavailable');
      selectedBranchId = input.branchId;
    }

    if (input.deviceCode) {
      const device = await this.prisma.device.findUnique({
        where: { deviceCode: input.deviceCode.trim() },
        select: { id: true, branchId: true, status: true, userId: true },
      });
      if (!device || device.status !== 'ACTIVE') throw new UnauthorizedException('Device is unavailable');
      if (user.branchId !== null && device.branchId !== user.branchId) throw new UnauthorizedException('Device is not registered to the user branch');
      if (selectedBranchId !== null && device.branchId !== selectedBranchId) throw new UnauthorizedException('Device does not belong to the selected branch');
      if (device.userId !== null && device.userId !== user.id) throw new UnauthorizedException('Device is assigned to another user');
      deviceId = device.id;
    }

    const roles = user.roleLinks.map(({ role }) => role.code as RoleCode);
    if (roles.length === 0) throw new UnauthorizedException('User has no assigned role');
    const permissions = [...new Set(roles.flatMap((role) => permissionsForRole(role)))];
    const availableWorkspaces = workspacesForAccess(roles, permissions);

    if (availableWorkspaces.length === 0) throw new UnauthorizedException('User has no application workspace access');
    if (input.workspace !== undefined && !availableWorkspaces.includes(input.workspace)) {
      throw new UnauthorizedException('User is not authorized for this workspace');
    }

    const workspace = input.workspace ?? availableWorkspaces[0];
    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const session = await this.prisma.session.create({
      data: { tokenHash: hashToken(accessToken), userId: user.id, branchId: selectedBranchId, deviceId, expiresAt },
      select: { id: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        branchId: selectedBranchId,
        action: 'AUTH_LOGIN',
        entityType: 'SESSION',
        entityId: session.id,
        metadata: { deviceId, kitchenStation: user.kitchenStation, workspace },
      },
    });

    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      workspace,
      availableWorkspaces,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        branchId: selectedBranchId,
        kitchenStation: user.kitchenStation,
        roles,
        permissions,
      },
      deviceId,
    };
  }

  async authenticate(accessToken: string): Promise<{ context: AuthContext; sessionId: string }> {
    if (!accessToken.trim()) throw new UnauthorizedException('Authentication required');

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(accessToken) },
      include: {
        branch: { select: { tenantId: true } },
        user: {
          select: {
            id: true,
            status: true,
            kitchenStation: true,
            roleLinks: { include: { role: { select: { code: true } } } },
          },
        },
      },
    });

    if (!session || session.revokedAt !== null || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session is expired or revoked');
    }

    const roles = session.user.roleLinks.map(({ role }) => role.code as RoleCode);
    if (roles.length === 0) throw new UnauthorizedException('User has no assigned role');
    const permissions = [...new Set(roles.flatMap((role) => permissionsForRole(role)))];

    return {
      context: buildAuthContext(
        {
          sessionId: session.id,
          userId: session.user.id,
          tenantId: session.branch?.tenantId ?? null,
          branchId: session.branchId,
          deviceId: session.deviceId,
          expiresAt: session.expiresAt,
          revokedAt: session.revokedAt,
        },
        roles,
        permissions,
        session.user.kitchenStation,
      ),
      sessionId: session.id,
    };
  }

  async logout(sessionId: string, actorUserId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId: actorUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId, action: 'AUTH_LOGOUT', entityType: 'SESSION', entityId: sessionId },
    });
  }
}
