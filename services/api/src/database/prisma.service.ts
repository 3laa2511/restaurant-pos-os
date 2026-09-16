import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    // Keep one process-wide Prisma client/pool and reuse database connections.
    // Values are deployment-configurable so API replicas can be sized against
    // the database connection budget instead of opening a connection per request.
    const maxConnections = envPositiveInt('DB_POOL_MAX', 10);
    const connectionTimeoutMillis = envPositiveInt('DB_POOL_CONNECTION_TIMEOUT_MS', 5_000);
    const idleTimeoutMillis = envPositiveInt('DB_POOL_IDLE_TIMEOUT_MS', 30_000);

    super({
      adapter: new PrismaPg({
        connectionString,
        max: maxConnections,
        connectionTimeoutMillis,
        idleTimeoutMillis,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
