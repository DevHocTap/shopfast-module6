import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Env } from '../../infra/config/env.schema';
import { HealthService, PROBE_TIMEOUT_MS } from './health.service';

function createService(db: () => Promise<unknown>, redis: () => Promise<unknown>): HealthService {
  const dataSource = { query: jest.fn(db) } as unknown as DataSource;
  const redisClient = { ping: jest.fn(redis) } as unknown as Redis;
  const config = { get: jest.fn(() => 'abc123') } as unknown as ConfigService<Env, true>;
  return new HealthService(dataSource, redisClient, config);
}

const ok = () => Promise.resolve('PONG');
const fail = () => Promise.reject(new Error('connection refused'));
const hang = () => new Promise(() => undefined);

describe('HealthService', () => {
  it('reports liveness with the deployed version', () => {
    const report = createService(ok, ok).liveness();

    expect(report.status).toBe('ok');
    expect(report.version).toBe('abc123');
  });

  it('is ok when database and redis respond', async () => {
    const report = await createService(ok, ok).readiness();

    expect(report.status).toBe('ok');
    expect(report.checks.database.status).toBe('up');
    expect(report.checks.redis.status).toBe('up');
  });

  it('is degraded (still serving) when only redis is down', async () => {
    const report = await createService(ok, fail).readiness();

    expect(report.status).toBe('degraded');
    // No internal error text in the public response.
    expect(report.checks.redis).toEqual({ status: 'down', latencyMs: expect.any(Number) });
  });

  it('is down when the database is unreachable', async () => {
    const report = await createService(fail, ok).readiness();

    expect(report.status).toBe('down');
  });

  it('treats a hanging dependency as down after the probe timeout', async () => {
    jest.useFakeTimers();
    const pending = createService(hang, ok).readiness();
    await jest.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
    const report = await pending;
    jest.useRealTimers();

    expect(report.status).toBe('down');
    expect(report.checks.database.status).toBe('down');
  });
});
