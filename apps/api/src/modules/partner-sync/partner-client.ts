import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Env } from '../../infra/config/env.schema';

export interface StockUpdate {
  productId: string;
  quantity: number;
  /** The partner ignores a key it has already applied: retries cannot double-apply an update. */
  idempotencyKey: string;
}

export const PARTNER_CLIENT = Symbol('PARTNER_CLIENT');

export interface PartnerClient {
  pushStock(update: StockUpdate): Promise<{ applied: boolean }>;
}

/**
 * Stand-in for the warehouse partner's API (no real partner in scope). It fails a configurable share
 * of calls (PARTNER_FAILURE_RATE) so retries, backoff and the dead letter can be demonstrated, and it
 * stores applied idempotency keys like a well-behaved partner would.
 */
@Injectable()
export class SimulatedPartnerClient implements PartnerClient {
  private readonly failureRate: number;
  /** Replaceable in tests to force success or failure. */
  random: () => number = Math.random;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService<Env, true>,
  ) {
    this.failureRate = config.get('PARTNER_FAILURE_RATE', { infer: true });
  }

  async pushStock(update: StockUpdate): Promise<{ applied: boolean }> {
    if (this.random() < this.failureRate) {
      throw new Error('Đối tác kho không phản hồi (lỗi giả lập 503)');
    }
    const rows: unknown[] = await this.dataSource.query(
      `INSERT INTO partner_sync_logs (idempotency_key, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key`,
      [update.idempotencyKey, update.productId, update.quantity],
    );
    return { applied: rows.length > 0 };
  }
}
