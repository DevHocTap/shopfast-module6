import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';

/**
 * Dead letter: when a job has used all its attempts, it is copied to `failed_jobs` with the reason,
 * so it survives Redis retention and an admin can inspect and re-run it.
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Called on every failure; only the final one is recorded (earlier ones will be retried). */
  async onFailed(queue: string, job: Job | undefined, error: Error): Promise<boolean> {
    if (!job) return false;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      this.logger.warn(
        `Job ${queue}/${job.name} (${job.id}) failed attempt ${job.attemptsMade}/${attempts}, will retry: ${error.message}`,
      );
      return false;
    }

    await this.dataSource.query(
      `INSERT INTO failed_jobs (queue, job_name, job_id, payload, reason, stacktrace, attempts_made)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        queue,
        job.name,
        job.id ?? null,
        JSON.stringify(job.data ?? {}),
        error.message,
        error.stack ?? null,
        job.attemptsMade,
      ],
    );
    this.logger.error(
      `Job ${queue}/${job.name} (${job.id}) moved to failed_jobs: ${error.message}`,
    );
    return true;
  }
}
