import { Module } from '@nestjs/common';
import { AppConfigModule } from './infra/config/config.module';
import { DatabaseModule } from './infra/database/database.module';
import { LoggerModule } from './infra/logger/logger.module';
import { MailModule } from './infra/mail/mail.module';
import { QueueModule } from './infra/queue/queue.module';
import { RedisModule } from './infra/redis/redis.module';
import { HeartbeatService } from './worker/heartbeat.service';
import { JobsModule } from './worker/jobs.module';

/** Modules loaded by the `worker` process: outbox relay, queue processors, nightly scheduler. */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    MailModule,
    QueueModule.forRoot({ failFast: false }),
    JobsModule,
  ],
  providers: [HeartbeatService],
})
export class WorkerModule {}
