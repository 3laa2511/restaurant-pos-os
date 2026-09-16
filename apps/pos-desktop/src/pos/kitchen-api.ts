import { getAccessToken, type KitchenStation } from './auth-client.js';

export type KitchenTicketStatus =
  | 'SENT_TO_KITCHEN'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';

export interface KitchenTicketItem {
  orderItemId: string;
  productNameSnapshot: string;
  quantity: number;
  modifiers: readonly string[];
  note?: string | null;
}

export interface KitchenTicket {
  id: string;
  orderId: string;
  branchId: string;
  station: KitchenStation;
  status: KitchenTicketStatus;
  version: number;
  sequence?: number;
  items: readonly KitchenTicketItem[];
  createdAt: string;
  sentAt?: string | null;
  preparingAt?: string | null;
  readyAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  order?: { orderNumber?: string; type?: string };
}

export interface KitchenTicketTransitionResult {
  ticketId: string;
  orderId: string;
  orderNumber: string;
  station: KitchenStation;
  status: KitchenTicketStatus;
  version: number;
  orderStatus: string;
  orderVersion: number;
}

export class KitchenApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'KitchenApiError';
  }
}

function buildUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/$/, '')}/api/${path.replace(/^\//, '')}`;
}

async function request<T>(apiBaseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error('Authenticated POS session is required');

  let response: Response;
  try {
    response = await fetch(buildUrl(apiBaseUrl, path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (cause) {
    throw new TypeError(cause instanceof Error ? cause.message : 'Kitchen API network request failed');
  }

  const body = await response.json().catch(() => null) as (T & { message?: string; error?: string }) | null;
  if (!response.ok) {
    const message = body && typeof body.message === 'string'
      ? body.message
      : body && typeof body.error === 'string'
        ? body.error
        : `Kitchen API request failed (${response.status})`;
    throw new KitchenApiError(message, response.status);
  }
  if (body === null) throw new Error('Kitchen API returned an empty response');
  return body;
}

export async function listKitchenTickets(
  apiBaseUrl: string,
  branchId?: string,
): Promise<KitchenTicket[]> {
  const query = branchId?.trim() ? `?branchId=${encodeURIComponent(branchId.trim())}` : '';
  const body = await request<KitchenTicket[] | { tickets: KitchenTicket[] }>(
    apiBaseUrl,
    `kitchen/tickets${query}`,
  );
  return Array.isArray(body) ? body : body.tickets;
}

export async function transitionKitchenTicket(
  apiBaseUrl: string,
  ticketId: string,
  target: KitchenTicketStatus,
  expectedVersion: number,
  reason?: string,
): Promise<KitchenTicketTransitionResult> {
  if (!ticketId.trim()) throw new Error('Kitchen ticket id is required');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('Kitchen ticket version is invalid');
  }

  return request<KitchenTicketTransitionResult>(
    apiBaseUrl,
    `kitchen/ticket/${encodeURIComponent(ticketId.trim())}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        target,
        expectedVersion,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      }),
    },
  );
}
