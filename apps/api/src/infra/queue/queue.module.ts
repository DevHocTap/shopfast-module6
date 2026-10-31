import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../config/config.module';
import { JOB_OPTIONS, QUEUE_NAMES } from './queue.constants';

/**
 * BullMQ on the shared Redis. Two flavours:
 * - api (producers inside HTTP requests): fail fast when Redis is down instead of queueing the
 *   command in memory and hanging the request
 * - worker (consumers): keep reconnecting patiently
 */
@Global()
@Module({})
export class QueueModule {
  static forRoot({ failFast }: { failFast: boolean }): DynamicModule {
    const queues = BullModule.registerQueue(
      ...QUEUE_NAMES.map((name) => ({ name, defaultJobOptions: JOB_OPTIONS[name] })),
    );
    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: AppConfigService) => ({
            prefix: 'shopfast',
            connection: {
              host: config.get('REDIS_HOST', { infer: true }),
              port: config.get('REDIS_PORT', { infer: true }),
              password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
              db: config.get('REDIS_DB', { infer: true }),
              ...(failFast ? { enableOfflineQueue: false, connectTimeout: 2000 } : {}),
            },
          }),
        }),
        queues,
      ],
      exports: [queues],
    };
  }
}
