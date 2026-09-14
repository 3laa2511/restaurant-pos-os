export type KitchenStation = 'KITCHEN' | 'BEVERAGE' | 'PACKING';

export interface DesktopSession {
  accessToken: string;
  expiresAt: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    branchId: string | null;
    kitchenStation: KitchenStation | null;
    roles: readonly string[];
    permissions: readonly string[];
  };
  deviceId: string | null;
}

const TOKEN_KEY = 'pos_access_token';
const SESSION_KEY = 'pos_session';

export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getDesktopSession(): DesktopSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DesktopSession;
    if (!parsed.accessToken || !parsed.expiresAt) return null;
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      clearDesktopSession();
      return null;
    }
    const session: DesktopSession = {
      ...parsed,
      user: {
        ...parsed.user,
        kitchenStation: parsed.user?.kitchenStation ?? null,
      },
    };
    return session;
  } catch {
    clearDesktopSession();
    return null;
  }
}

export function saveDesktopSession(session: DesktopSession): void {
  sessionStorage.setItem(TOKEN_KEY, session.accessToken);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearDesktopSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

export async function loginDesktop(
  apiBaseUrl: string,
  input: { username: string; password: string; branchId?: string; deviceCode?: string },
): Promise<DesktopSession> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => null) as Partial<DesktopSession> & { message?: string } | null;
  if (!response.ok || !body?.accessToken || !body.user) {
    throw new Error(typeof body?.message === 'string' ? body.message : 'تعذر تسجيل الدخول');
  }

  const session: DesktopSession = {
    accessToken: body.accessToken,
    expiresAt: String(body.expiresAt),
    user: {
      ...body.user,
      kitchenStation: body.user.kitchenStation ?? null,
    },
    deviceId: body.deviceId ?? null,
  };
  saveDesktopSession(session);
  return session;
}

export async function logoutDesktop(apiBaseUrl: string): Promise<void> {
  const token = getAccessToken();
  try {
    if (token) {
      await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } finally {
    clearDesktopSession();
  }
}
