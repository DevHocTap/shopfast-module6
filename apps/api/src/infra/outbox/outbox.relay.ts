import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Env } from '../config/env.schema';
import { QUEUE_NAMES, QueueName } from '../queue/queue.constants';
import { jobsFor, StoredEvent } from './outbox-dispatch';

export const OUTBOX_BATCH_SIZE = 100;

/**
 * Worker-side loop: moves committed outbox events into BullMQ.
 * `FOR UPDATE SKIP LOCKED` lets several workers share the table without taking the same rows.
 * If Redis is down the transaction rolls back and the events simply wait for the next tick.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly pollMs: number;
  private readonly reminderDelayMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastErrorAt = 0;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly moduleRef: ModuleRef,
    config: ConfigService<Env, true>,
  ) {
    this.pollMs = config.get('OUTBOX_POLL_MS', { infer: true });
    this.reminderDelayMs = config.get('PAYMENT_REMINDER_DELAY_MINUTES', { infer: true }) * 60_000;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.drain(), this.pollMs);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Publishes batches until the outbox is empty. Safe to call concurrently (no-op if busy). */
  async drain(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let total = 0;
    try {
      for (;;) {
        const published = await this.publishBatch();
        total += published;
        if (published < OUTBOX_BATCH_SIZE) break;
      }
    } catch (error) {
      if (Date.now() - this.lastErrorAt > 10_000) {
        this.lastErrorAt = Date.now();
        this.logger.warn(`Outbox publish failed, will retry: ${(error as Error).message}`);
      }
    } finally {
      this.running = false;
    }
    return total;
  }

  private publishBatch(): Promise<number> {
    return this.dataSource.transaction(async (tx) => {
      const rows: {
        id: string;
        event_type: string;
        aggregate_id: string;
        payload: Record<string, unknown>;
      }[] = await tx.query(
        `SELECT id, event_type, aggregate_id, payload FROM outbox_events
            WHERE published_at IS NULL ORDER BY id
            LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [OUTBOX_BATCH_SIZE],
      );
      if (rows.length === 0) return 0;

      for (const row of rows) {
        const event: StoredEvent = {
          id: row.id,
          type: row.event_type,
          aggregateId: row.aggregate_id,
          payload: row.payload,
        };
        for (const job of jobsFor(event, this.reminderDelayMs)) {
          await this.queue(job.queue).add(job.name, job.data, {
            jobId: job.jobId,
            delay: job.delayMs,
          });
        }
      }
      await tx.query('UPDATE outbox_events SET published_at = now() WHERE id = ANY($1::bigint[])', [
        rows.map((row) => row.id),
      ]);
      return rows.length;
    });
  }

  private queue(name: QueueName): Queue {
    if (!QUEUE_NAMES.includes(name)) throw new Error(`Unknown queue ${name}`);
    return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
  }
}
