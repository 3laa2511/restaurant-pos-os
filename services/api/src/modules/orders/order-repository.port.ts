import type { OrderStatus } from './order-status.js';

export interface CreateOrderRecord {
  id: string;
  orderNumber: string;
  branchId: string;
  tenantId: string;
  createdById: string;
  source: string;
  type: string;
  status: OrderStatus;
  total: string;
  version: number;
}

export interface OrderRepository {
  findById(id: string, tenantId: string): Promise<CreateOrderRecord | null>;
  create(input: Omit<CreateOrderRecord, 'version'>): Promise<CreateOrderRecord>;
  transition(
    id: string,
    tenantId: string,
    expectedVersion: number,
    status: OrderStatus,
  ): Promise<CreateOrderRecord>;
}
