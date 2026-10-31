import { Module } from '@nestjs/common';
import { AppConfigModule } from './infra/config/config.module';
import { DatabaseModule } from './infra/database/database.module';
import { LoggerModule } from './infra/logger/logger.module';
import { RedisModule } from './infra/redis/redis.module';
import { HeartbeatService } from './worker/heartbeat.service';

/** Modules loaded by the `worker` process: queue processors, outbox relay, schedulers (from phase 3). */
@Module({
  imports: [AppConfigModule, LoggerModule, DatabaseModule, RedisModule],
  providers: [HeartbeatService],
})
export class WorkerModule {}
