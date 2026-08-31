export interface OrderTransactionPort {
  run<T>(work: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface OrderPersistenceTransaction {
  createOrder(input: {
    id: string;
    orderNumber: string;
    branchId: string;
    createdById: string;
    source: string;
    type: string;
    total: string;
  }): Promise<{ id: string; version: number }>;
  appendOrderEvent(input: {
    eventId: string;
    orderId: string;
    branchId: string;
    actorUserId: string | null;
    deviceId: string | null;
    type: string;
    version: number;
    occurredAt: Date;
    payload: Record<string, unknown>;
  }): Promise<void>;
  appendAudit(input: {
    actorUserId: string;
    branchId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
