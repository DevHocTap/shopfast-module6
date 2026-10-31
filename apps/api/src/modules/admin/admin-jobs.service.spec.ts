import { getQueueToken } from '@nestjs/bullmq';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { DeadLetterService } from '../../infra/queue/dead-letter.service';
import { ReportsRepository } from '../reports/reports.repository';
import { AdminJobsService } from './admin-jobs.service';

function setup() {
  const queue = {
    getJobCounts: jest
      .fn()
      .mockResolvedValue({ waiting: 2, active: 1, delayed: 3, completed: 9, failed: 1 }),
    add: jest.fn().mockResolvedValue({}),
  };
  const moduleRef = {
    get: jest.fn((token: string) => (token.startsWith(getQueueToken('')) ? queue : queue)),
  };
  const dataSource = { query: jest.fn() };
  const reports = { recent: jest.fn().mockResolvedValue([]) };
  const service = new AdminJobsService(
    moduleRef as unknown as ModuleRef,
    dataSource as unknown as DataSource,
    reports as unknown as ReportsRepository,
  );
  return { service, queue, dataSource, reports };
}

describe('AdminJobsService', () => {
  it('reports counts for every queue and the unpublished outbox backlog', async () => {
    const { service, dataSource } = setup();
    dataSource.query.mockResolvedValueOnce([{ count: '4' }]);

    const stats = await service.queueStats();

    expect(stats.pendingOutboxEvents).toBe(4);
    expect(stats.queues).toHaveLength(5);
    expect(stats.queues[0]).toMatchObject({
      waiting: 2,
      active: 1,
      delayed: 3,
      completed: 9,
      failed: 1,
    });
  });

  it('answers 503 with a clear message when Redis does not respond', async () => {
    const { service, dataSource, queue } = setup();
    dataSource.query.mockResolvedValueOnce([{ count: '0' }]);
    queue.getJobCounts.mockReturnValue(new Promise(() => undefined));

    await expect(service.queueStats()).rejects.toMatchObject({
      status: 503,
      response: { code: 'QUEUE_UNAVAILABLE' },
    });
  });

  it('re-enqueues a dead job once with a fresh id', async () => {
    const { service, dataSource, queue } = setup();
    dataSource.query.mockResolvedValueOnce([
      {
        queue: 'inventory-sync',
        job_name: 'push-stock',
        job_id: 'inventory-sync-p1-9',
        payload: { productId: 'p1' },
        retried_at: null,
      },
    ]);

    await service.retry('1');

    expect(queue.add).toHaveBeenCalledWith(
      'push-stock',
      { productId: 'p1' },
      { jobId: expect.stringMatching(/^inventory-sync-p1-9-retry-\d+$/) },
    );
    expect(dataSource.query).toHaveBeenLastCalledWith(
      'UPDATE failed_jobs SET retried_at = now() WHERE id = $1',
      ['1'],
    );
  });

  it('refuses unknown, already retried or foreign-queue jobs', async () => {
    const { service, dataSource } = setup();
    dataSource.query.mockResolvedValueOnce([]);
    await expect(service.retry('x')).rejects.toMatchObject({ status: 404 });

    dataSource.query.mockResolvedValueOnce([
      { queue: 'email', job_name: 'otp', job_id: null, payload: {}, retried_at: new Date() },
    ]);
    await expect(service.retry('y')).rejects.toMatchObject({ status: 409 });

    dataSource.query.mockResolvedValueOnce([
      { queue: 'legacy', job_name: 'x', job_id: null, payload: {}, retried_at: null },
    ]);
    await expect(service.retry('z')).rejects.toMatchObject({ status: 400 });
  });

  it('can run the nightly report on demand and list recent reports', async () => {
    const { service, queue, reports } = setup();

    await service.runDailyReport('2026-10-30');
    await service.recentReports();

    expect(queue.add).toHaveBeenCalledWith(
      'daily-revenue',
      { date: '2026-10-30' },
      expect.anything(),
    );
    expect(reports.recent).toHaveBeenCalledWith(14);
  });

  it('lists dead jobs newest first', async () => {
    const { service, dataSource } = setup();
    dataSource.query.mockResolvedValueOnce([
      {
        id: '1',
        queue: 'email',
        job_name: 'otp',
        job_id: 'otp-1',
        payload: {},
        reason: 'SMTP',
        attempts_made: 5,
        failed_at: new Date(),
        retried_at: null,
      },
    ]);

    await expect(service.failedJobs()).resolves.toEqual([
      expect.objectContaining({ id: '1', jobName: 'otp', reason: 'SMTP', attemptsMade: 5 }),
    ]);
  });
});

describe('DeadLetterService', () => {
  it('records only the final failure of a job', async () => {
    const dataSource = { query: jest.fn() };
    const service = new DeadLetterService(dataSource as unknown as DataSource);
    const job = (attemptsMade: number) =>
      ({
        name: 'push-stock',
        id: 'j1',
        data: { productId: 'p' },
        opts: { attempts: 3 },
        attemptsMade,
      }) as never;

    await expect(service.onFailed('inventory-sync', job(2), new Error('503'))).resolves.toBe(false);
    await expect(service.onFailed('inventory-sync', job(3), new Error('503'))).resolves.toBe(true);
    await expect(service.onFailed('inventory-sync', undefined, new Error('x'))).resolves.toBe(
      false,
    );

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO failed_jobs'),
      ['inventory-sync', 'push-stock', 'j1', '{"productId":"p"}', '503', expect.any(String), 3],
    );
  });
});
