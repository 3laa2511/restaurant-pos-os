export interface SqlExecutor {
  exec(sql: string, params?: readonly unknown[]): Promise<void>;
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

export interface LocalStorageHealth {
  driver: 'sqlite';
  persistent: boolean;
  ready: boolean;
}

export async function initializeLocalDatabase(db: SqlExecutor, schema: string): Promise<LocalStorageHealth> {
  await db.exec(schema);
  return { driver: 'sqlite', persistent: true, ready: true };
}
