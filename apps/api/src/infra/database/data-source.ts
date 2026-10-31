import 'reflect-metadata';
// Local CLI runs read apps/api/.env; in containers the variables come from the environment.
import 'dotenv/config';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { validateDbEnv } from '../config/env.schema';

/** DataSource for the TypeORM CLI and the standalone migration runner. */
export function createDataSource(): DataSource {
  const env = validateDbEnv(process.env);
  return new DataSource({
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: [join(__dirname, '..', '..', '**', '*.{entity,entities}.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    migrationsTableName: 'migrations',
  });
}

export default createDataSource();
