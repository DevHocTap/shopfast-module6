import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { BreakerState, CircuitBreaker } from './circuit-breaker';
import { REDIS_CLIENT } from './redis.constants';

/** Returned instead of throwing when Redis cannot be used; callers fall back (DB, memory). */
export const UNAVAILABLE = Symbol('REDIS_UNAVAILABLE');
export type Unavailable = typeof UNAVAILABLE;

/**
 * Every optional Redis use (cache, rate limit counters, OTP) goes through here.
 * Redis is not allowed to take the API down: errors become UNAVAILABLE and trip the breaker.
 */
@Injectable()
export class ResilientRedis {
  private readonly logger = new Logger(ResilientRedis.name);
  private readonly breaker = new CircuitBreaker();
  private lastWarnAt = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  get state(): BreakerState {
    return this.breaker.state;
  }

  async run<T>(operation: (client: Redis) => Promise<T>): Promise<T | Unavailable> {
    if (!this.breaker.canRequest()) return UNAVAILABLE;
    try {
      const result = await operation(this.redis);
      this.breaker.success();
      return result;
    } catch (error) {
      this.breaker.failure();
      if (Date.now() - this.lastWarnAt > 10_000) {
        this.lastWarnAt = Date.now();
        this.logger.warn(
          `Redis call failed, falling back (breaker ${this.breaker.state}): ${(error as Error).message}`,
        );
      }
      return UNAVAILABLE;
    }
  }
}
