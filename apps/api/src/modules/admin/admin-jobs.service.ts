import { getQueueToken } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/errors/app-error';
import { jobId, QUEUE_NAMES, QueueName, QUEUES } from '../../infra/queue/queue.constants';
import { DailyRevenue, ReportsRepository } from '../reports/reports.repository';

export interface QueueStats {
  name: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export interface FailedJob {
  id: string;
  queue: string;
  jobName: string;
  jobId: string | null;
  payload: unknown;
  reason: string;
  attemptsMade: number;
  failedAt: Date;
  retriedAt: Date | null;
}

const QUEUE_TIMEOUT_MS = 1500;

const queueUnavailable = () =>
  new AppError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'QUEUE_UNAVAILABLE',
    'Không đọc được hàng đợi (Redis không phản hồi). Các sự kiện vẫn được giữ an toàn trong outbox.',
  );

/** F07: queue dashboard data, dead-letter inspection and manual re-run. */
@Injectable()
export class AdminJobsService {
  constructor(
    private readonly moduleRef: ModuleRef,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reports: ReportsRepository,
  ) {}

  async queueStats(): Promise<{ queues: QueueStats[]; pendingOutboxEvents: number }> {
    const [{ count }]: { count: string }[] = await this.dataSource.query(
      'SELECT count(*) FROM outbox_events WHERE published_at IS NULL',
    );
    const queues = await withTimeout(
      Promise.all(
        QUEUE_NAMES.map(async (name) => {
          const counts = await this.queue(name).getJobCounts(
            'waiting',
            'active',
            'delayed',
            'completed',
            'failed',
          );
          return {
            name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
          };
        }),
      ),
    );
    return { queues, pendingOutboxEvents: Number(count) };
  }

  async failedJobs(limit = 50): Promise<FailedJob[]> {
    const rows: {
      id: string;
      queue: string;
      job_name: string;
      job_id: string | null;
      payload: unknown;
      reason: string;
      attempts_made: number;
      failed_at: Date;
      retried_at: Date | null;
    }[] = await this.dataSource.query(
      `SELECT id, queue, job_name, job_id, payload, reason, attempts_made, failed_at, retried_at
         FROM failed_jobs ORDER BY failed_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      queue: row.queue,
      jobName: row.job_name,
      jobId: row.job_id,
      payload: row.payload,
      reason: row.reason,
      attemptsMade: row.attempts_made,
      failedAt: row.failed_at,
      retriedAt: row.retried_at,
    }));
  }

  /** Re-enqueues a dead job with a fresh id (processors are idempotent, so this is always safe). */
  async retry(failedJobId: string): Promise<void> {
    const [row]: {
      queue: string;
      job_name: string;
      job_id: string | null;
      payload: Record<string, unknown>;
      retried_at: Date | null;
    }[] = await this.dataSource.query(
      'SELECT queue, job_name, job_id, payload, retried_at FROM failed_jobs WHERE id = $1',
      [failedJobId],
    );
    if (!row) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'FAILED_JOB_NOT_FOUND',
        'Không tìm thấy tác vụ lỗi.',
      );
    }
    if (row.retried_at) {
      throw new AppError(HttpStatus.CONFLICT, 'ALREADY_RETRIED', 'Tác vụ này đã được chạy lại.');
    }
    if (!QUEUE_NAMES.includes(row.queue as QueueName)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'UNKNOWN_QUEUE', 'Hàng đợi không còn tồn tại.');
    }
    await withTimeout(
      this.queue(row.queue as QueueName).add(row.job_name, row.payload, {
        jobId: jobId(row.job_id ?? row.job_name, 'retry', Date.now()),
      }),
    );
    await this.dataSource.query('UPDATE failed_jobs SET retried_at = now() WHERE id = $1', [
      failedJobId,
    ]);
  }

  /** For the demo: run the nightly report now (for yesterday, or a given day). */
  async runDailyReport(date?: string): Promise<void> {
    await withTimeout(
      this.queue(QUEUES.report).add('daily-revenue', date ? { date } : {}, {
        jobId: jobId('daily-revenue-manual', date ?? 'yesterday', Date.now()),
      }),
    );
  }

  recentReports(): Promise<DailyRevenue[]> {
    return this.reports.recent(14);
  }

  private queue(name: QueueName): Queue {
    return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
  }
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), QUEUE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    throw queueUnavailable();
  } finally {
    clearTimeout(timer);
  }
}
