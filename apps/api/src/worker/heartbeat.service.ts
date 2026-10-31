import { writeFile } from 'node:fs/promises';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../infra/config/env.schema';

export const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * The worker has no HTTP port, so its container healthcheck checks that this file
 * was touched recently. A frozen event loop stops the heartbeat and marks the container unhealthy.
 */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HeartbeatService.name);
  private readonly file: string;
  private timer?: NodeJS.Timeout;

  constructor(config: ConfigService<Env, true>) {
    this.file = config.get('WORKER_HEARTBEAT_FILE', { infer: true });
  }

  onApplicationBootstrap(): void {
    void this.beat();
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS);
    this.logger.log('Worker started');
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async beat(): Promise<void> {
    try {
      await writeFile(this.file, new Date().toISOString());
    } catch (error) {
      this.logger.warn(`Cannot write heartbeat: ${(error as Error).message}`);
    }
  }
}
