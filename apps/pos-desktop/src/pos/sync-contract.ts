export interface SyncQueueItem {
  id: string;
  device_id: string;
  branch_id: string;
  operation: string;
  entity_type: string;
  entity_id: string;
  idempotency_key: string;
  client_sequence: number;
  payload: string;
  occurred_at: string;
  status: string;
  retry_count: number;
  last_error: string | null;
}

export interface SyncTransport {
  push(item: SyncQueueItem): Promise<void>;
}
