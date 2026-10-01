import type { CreateOrderRecord, OrderRepository } from './order-repository.port.js';
import type { OrderStatus } from './order-status.js';
import type { AuthContext } from '../auth/authorization.types.js';

export class InMemoryOrderRepository implements OrderRepository {
  private readonly records = new Map<string, CreateOrderRecord>();

  async findById(id: string, tenantId: string, _context: AuthContext): Promise<CreateOrderRecord | null> {
    void _context;
    const record = this.records.get(id);
    return record?.tenantId === tenantId ? record : null;
  }

  async create(input: Omit<CreateOrderRecord, 'version'>, _context: AuthContext): Promise<CreateOrderRecord> {
    void _context;
    const record: CreateOrderRecord = { ...input, version: 1 };
    this.records.set(record.id, record);
    return record;
  }

  async transition(
    id: string,
    tenantId: string,
    expectedVersion: number,
    status: OrderStatus,
    _context: AuthContext,
  ): Promise<CreateOrderRecord> {
    void _context;
    const current = this.records.get(id);
    if (!current || current.tenantId !== tenantId) throw new Error('Order not found in tenant scope');
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
