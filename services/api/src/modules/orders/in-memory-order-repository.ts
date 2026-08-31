import type { CreateOrderRecord, OrderRepository } from './order-repository.port.js';
import type { OrderStatus } from './order-status.js';

export class InMemoryOrderRepository implements OrderRepository {
  private readonly records = new Map<string, CreateOrderRecord>();

  async findById(id: string): Promise<CreateOrderRecord | null> {
    return this.records.get(id) ?? null;
  }

  async create(input: Omit<CreateOrderRecord, 'version'>): Promise<CreateOrderRecord> {
    const record: CreateOrderRecord = { ...input, version: 1 };
    this.records.set(record.id, record);
    return record;
  }

  async transition(
    id: string,
    expectedVersion: number,
    status: OrderStatus,
  ): Promise<CreateOrderRecord> {
    const current = this.records.get(id);
    if (!current) throw new Error('Order not found');
    if (current.version !== expectedVersion) {
      throw new Error('Order was changed by another operation');
    }

    const next: CreateOrderRecord = {
      ...current,
      status,
      version: current.version + 1,
    };
    this.records.set(id, next);
    return next;
  }
}
