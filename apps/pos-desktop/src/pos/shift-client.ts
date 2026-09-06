import { getAccessToken } from './auth-client.js';
import type { PosRuntimeIdentity } from './runtime-identity.js';
import type { Shift } from './shift.js';

interface CurrentShiftResponse {
  shiftId: string;
  branchId: string;
  deviceId: string;
  cashierId: string;
  status: 'OPEN';
  openingCash: number;
  openedAt: string;
}

interface ShiftMutationResponse {
  operationId: string;
  shiftId: string;
  status: 'OPEN' | 'CLOSED';
  openingCash?: number;
  expectedCash?: number;
  actualCash?: number;
  variance?: number;
  openedAt?: string;
  closedAt?: string;
}

const normalizeBaseUrl = (apiBaseUrl: string) => apiBaseUrl.replace(/\/$/, '');

async function request<T>(apiBaseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error('Authenticated POS session is required');
  const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : `Shift request failed (${response.status})`);
  return body as T;
}

export async function getCurrentShift(apiBaseUrl: string, identity: PosRuntimeIdentity): Promise<Shift | null> {
  const result = await request<CurrentShiftResponse>(apiBaseUrl, '/api/shifts/current');
  if (result.branchId !== identity.branchId || result.deviceId !== identity.deviceId || result.cashierId !== identity.cashierId) throw new Error('Server returned a shift outside the authenticated POS scope');
  return {
    id: result.shiftId,
    branchId: result.branchId,
    deviceId: result.deviceId,
    cashierId: result.cashierId,
    status: 'OPEN',
    openingCash: result.openingCash,
    closingCash: null,
    expectedCash: null,
    variance: null,
    openedAt: result.openedAt,
    closedAt: null,
  };
}

export async function openServerShift(apiBaseUrl: string, identity: PosRuntimeIdentity, openingCash: number, clientSequence: number, idempotencyKey: string): Promise<Shift> {
  const result = await request<ShiftMutationResponse>(apiBaseUrl, '/api/shifts/open', { method: 'POST', body: JSON.stringify({ branchId: identity.branchId, deviceId: identity.deviceId, openingCash, idempotencyKey, clientSequence }) });
  if (result.status !== 'OPEN') throw new Error('Server did not open the shift');
  return {
    id: result.shiftId,
    branchId: identity.branchId,
    deviceId: identity.deviceId,
    cashierId: identity.cashierId,
    status: 'OPEN',
    openingCash: result.openingCash ?? openingCash,
    closingCash: null,
    expectedCash: null,
    variance: null,
    openedAt: result.openedAt ?? new Date().toISOString(),
    closedAt: null,
  };
}

export async function closeServerShift(apiBaseUrl: string, shiftId: string, closingCash: number, clientSequence: number, idempotencyKey: string): Promise<ShiftMutationResponse> {
  return request<ShiftMutationResponse>(apiBaseUrl, '/api/shifts/close', { method: 'POST', body: JSON.stringify({ shiftId, closingCash, idempotencyKey, clientSequence }) });
}
