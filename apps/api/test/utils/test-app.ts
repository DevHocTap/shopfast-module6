import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { createDataSource } from '../../src/infra/database/data-source';
import { REDIS_CLIENT } from '../../src/infra/redis/redis.constants';

const TABLES = [
  'outbox_events',
  'email_logs',
  'invoices',
  'failed_jobs',
  'daily_revenue_reports',
  'partner_sync_logs',
  'voucher_redemptions', // vouchers themselves are seeded by a migration and stay
  'payments',
  'order_status_history',
  'order_items',
  'orders',
  'cart_items',
  'inventory_movements',
  'inventories',
  'products',
  'brands',
  'categories',
  'refresh_tokens',
  'users',
];

/**
 * Full application against real PostgreSQL + Redis. Integration tests TRUNCATE tables, so they
 * refuse to run unless the database name ends with `_test` (never the dev or prod database).
 *   local: DB_NAME=shopfast_test pnpm --filter api test:int
 */
export async function createTestApp(): Promise<{
  app: NestExpressApplication;
  dataSource: DataSource;
}> {
  const migrator = createDataSource();
  const database = String(migrator.options.database);
  if (!database.endsWith('_test')) {
    throw new Error(
      `Integration tests truncate tables: DB_NAME must end with "_test" (got "${database}").`,
    );
  }
  await migrator.initialize();
  await migrator.runMigrations({ transaction: 'each' });
  await migrator.destroy();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return { app, dataSource: app.get<DataSource>(getDataSourceToken()) };
}

/** Empties the test database and the test Redis DB (rate-limit counters, cache, OTP codes). */
export async function resetDatabase(app: NestExpressApplication): Promise<void> {
  const dataSource = app.get<DataSource>(getDataSourceToken());
  await dataSource.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  const redis = app.get<Redis>(REDIS_CLIENT);
  if ((redis.options.db ?? 0) === 0) {
    throw new Error(
      'Integration tests flush Redis: set REDIS_DB to a dedicated database (e.g. 1).',
    );
  }
  await redis.flushdb();
}

let ipCounter = 0;

/**
 * supertest client that gives every request its own client IP (X-Forwarded-For; the app trusts
 * one proxy hop), so per-IP rate limits only trigger in tests that pin an IP on purpose.
 */
export function httpClient(app: NestExpressApplication) {
  const agent = request(app.getHttpServer());
  const withIp = (test: request.Test) => {
    ipCounter += 1;
    return test.set(
      'X-Forwarded-For',
      `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`,
    );
  };
  return {
    get: (url: string) => withIp(agent.get(url)),
    post: (url: string) => withIp(agent.post(url)),
    put: (url: string) => withIp(agent.put(url)),
    patch: (url: string) => withIp(agent.patch(url)),
    delete: (url: string) => withIp(agent.delete(url)),
  };
}

export type HttpClient = ReturnType<typeof httpClient>;
