export type SyncQueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE' | 'CHECKOUT';

export interface SyncQueueItem {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperation;
  idempotency_key: string;
  client_sequence: number;
  payload: string;
  status: SyncQueueStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncTransport {
  push(item: SyncQueueItem): Promise<void>;
}
