import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { createDataSource } from '../../src/infra/database/data-source';

const TABLES = [
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

export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
