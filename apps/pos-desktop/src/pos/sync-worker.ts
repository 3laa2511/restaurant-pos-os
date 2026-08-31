import type { Order } from './order.js';
import type { LocalStore } from './local-store.js';
import { markSyncing, markSynced, markSyncFailed } from './local-store.js';

export interface SyncTransport {
  pushOrder(order: Order): Promise<'APPLIED' | 'DUPLICATE'>;
}

export async function syncPendingOrders(store: LocalStore, transport: SyncTransport): Promise<void> {
  for (const orderId of [...store.syncQueue]) {
    const record = store.orders.get(orderId);
    if (!record || record.syncStatus === 'SYNCED') continue;
    markSyncing(store, orderId);
    try {
      const result = await transport.pushOrder(record.order);
      if (result === 'APPLIED' || result === 'DUPLICATE') markSynced(store, orderId);
    } catch (error) {
      markSyncFailed(store, orderId, error instanceof Error ? error.message : 'Unknown sync error');
    }
  }
}
