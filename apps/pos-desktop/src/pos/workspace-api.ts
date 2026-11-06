import { getAccessToken } from './auth-client.js';

export const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

async function request<T>(path: string, init: RequestInit, fallbackMessage: string): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error('انتهت جلسة الدخول، سجّل الدخول مرة أخرى.');

  const response = await fetch(
    API_BASE_URL.replace(/\/$/, '') + '/api/' + path.replace(/^\//, ''),
    {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: 'Bearer ' + token,
        ...init.headers,
      },
    },
  );
  const body = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
      ? body.message
      : fallbackMessage + ' (' + response.status + ')';
    throw new Error(message);
  }
  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' }, 'تعذر تحميل البيانات');
}

export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(payload) }, 'تعذر تنفيذ العملية');
}
