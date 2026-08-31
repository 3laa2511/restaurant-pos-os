import type { Order } from './order.js';

export type LocalSyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface LocalOrderRecord {
  order: Order;
  syncStatus: LocalSyncStatus;
  syncAttempts: number;
  lastSyncError: string | null;
}

export interface LocalStore {
  orders: Map<string, LocalOrderRecord>;
  syncQueue: string[];
}

export function createLocalStore(): LocalStore {
  return { orders: new Map(), syncQueue: [] };
}

export function saveOrderLocal(store: LocalStore, order: Order): LocalStore {
  if (store.orders.has(order.id)) return store;
  store.orders.set(order.id, { order, syncStatus: 'PENDING', syncAttempts: 0, lastSyncError: null });
  store.syncQueue.push(order.id);
  return store;
}

export function markSyncing(store: LocalStore, orderId: string): void {
  const record = store.orders.get(orderId);
  if (!record) throw new Error('Local order not found');
  record.syncStatus = 'SYNCING';
  record.syncAttempts += 1;
}

export function markSynced(store: LocalStore, orderId: string): void {
  const record = store.orders.get(orderId);
  if (!record) throw new Error('Local order not found');
  record.syncStatus = 'SYNCED';
  record.lastSyncError = null;
  store.syncQueue = store.syncQueue.filter((id) => id !== orderId);
}

export function markSyncFailed(store: LocalStore, orderId: string, error: string): void {
  const record = store.orders.get(orderId);
  if (!record) throw new Error('Local order not found');
  record.syncStatus = 'FAILED';
  record.lastSyncError = error;
}
