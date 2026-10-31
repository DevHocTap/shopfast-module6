import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/** A database transaction handle passed from services to repositories. */
export type Tx = EntityManager;

/**
 * Services decide *what* must be atomic; repositories decide *how* to talk SQL.
 * Unit tests replace this with a runner that simply invokes the callback.
 */
@Injectable()
export class TransactionRunner {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.dataSource.transaction('READ COMMITTED', work);
  }
}

/**
 * Runs `UPDATE … RETURNING` / `DELETE … RETURNING` and returns the rows.
 * TypeORM's postgres driver answers those statements with `[rows, affectedCount]`
 * instead of plain rows (SELECT and INSERT return plain rows).
 */
export async function returningRows<T>(tx: Tx, sql: string, params: unknown[]): Promise<T[]> {
  const result: unknown = await tx.query(sql, params);
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0])) {
    return result[0] as T[];
  }
  return result as T[];
}

/** PostgreSQL error code for unique_violation. */
export const PG_UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const driverError = (error as { driverError?: { code?: string; constraint?: string } })
    ?.driverError;
  const details = driverError ?? (error as { code?: string; constraint?: string });
  return (
    details?.code === PG_UNIQUE_VIOLATION &&
    (constraint === undefined || details.constraint === constraint)
  );
}
