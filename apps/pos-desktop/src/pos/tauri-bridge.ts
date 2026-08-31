export interface TauriInvoke {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export interface LocalDatabaseBridge {
  initialize(): Promise<void>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
}

export function createDatabaseBridge(invoke: TauriInvoke): LocalDatabaseBridge {
  return {
    initialize: () => invoke.invoke('db_initialize'),
    execute: (sql, params = []) => invoke.invoke('db_execute', { sql, params }),
    query: (sql, params = []) => invoke.invoke('db_query', { sql, params }),
    transaction: (statements) => invoke.invoke('db_transaction', { statements }),
  };
}
