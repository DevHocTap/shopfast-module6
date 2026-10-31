import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfigService } from '../config/config.module';
import { REDIS_CLIENT } from './redis.constants';
import { ResilientRedis } from './resilient-redis';

/**
 * Shared Redis connection. Tuned to fail fast instead of hanging:
 * Redis is optional for serving traffic (fail-open), so a slow Redis must never stall a request.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: AppConfigService): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis({
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
          db: config.get('REDIS_DB', { infer: true }),
          connectionName: 'shopfast',
          commandTimeout: 200,
          connectTimeout: 2000,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
        });
        let lastErrorLoggedAt = 0;
        client.on('error', (error: Error) => {
          // Throttle the log: a dead Redis emits an error on every reconnect attempt.
          if (Date.now() - lastErrorLoggedAt > 10_000) {
            lastErrorLoggedAt = Date.now();
            logger.warn(`Redis unavailable: ${error.message}`);
          }
        });
        client.on('ready', () => logger.log('Redis connected'));
        return client;
      },
    },
    ResilientRedis,
  ],
  exports: [REDIS_CLIENT, ResilientRedis],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
