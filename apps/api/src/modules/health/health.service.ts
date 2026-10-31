import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Env } from '../../infra/config/env.schema';
import { REDIS_CLIENT } from '../../infra/redis/redis.constants';

export const PROBE_TIMEOUT_MS = 1000;

export interface ComponentCheck {
  status: 'up' | 'down';
  latencyMs: number;
}

/**
 * ok       — every dependency is up.
 * degraded — Redis is down: still serving (cache bypassed), just slower.
 * down     — PostgreSQL is down: cannot serve, load balancer / deploy must not route here.
 */
export type ReadinessStatus = 'ok' | 'degraded' | 'down';

export interface ReadinessReport {
  status: ReadinessStatus;
  version: string;
  checks: { database: ComponentCheck; redis: ComponentCheck };
}

export interface LivenessReport {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly version: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.version = config.get('APP_VERSION', { infer: true });
  }

  liveness(): LivenessReport {
    return { status: 'ok', version: this.version, uptimeSeconds: Math.round(process.uptime()) };
  }

  async readiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      this.probe('database', () => this.dataSource.query('SELECT 1')),
      this.probe('redis', () => this.redis.ping()),
    ]);
    return {
      status: overallStatus(database, redis),
      version: this.version,
      checks: { database, redis },
    };
  }

  /** The endpoint is public: failure details go to the server log, never into the response. */
  private async probe(name: string, check: () => Promise<unknown>): Promise<ComponentCheck> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timeout after ${PROBE_TIMEOUT_MS}ms`)),
        PROBE_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([check(), timeout]);
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Health probe "${name}" failed: ${message}`);
      return { status: 'down', latencyMs: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function overallStatus(database: ComponentCheck, redis: ComponentCheck): ReadinessStatus {
  if (database.status === 'down') return 'down';
  if (redis.status === 'down') return 'degraded';
  return 'ok';
}
