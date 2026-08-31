import type { Order } from './order.js';
import type { LocalStore } from './local-store.js';
import { saveOrderLocal } from './local-store.js';

export interface LocalOrderRepository {
  insert(order: Order): void;
  getById(orderId: string): Order | null;
  pendingSyncIds(): string[];
}

export class MemoryOrderRepository implements LocalOrderRepository {
  constructor(private readonly store: LocalStore) {}

  insert(order: Order): void {
    saveOrderLocal(this.store, order);
  }

  getById(orderId: string): Order | null {
    return this.store.orders.get(orderId)?.order ?? null;
  }

  pendingSyncIds(): string[] {
    return [...this.store.syncQueue];
  }
}
