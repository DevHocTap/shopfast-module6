import { Injectable } from '@nestjs/common';
import { ResilientRedis, UNAVAILABLE } from '../../infra/redis/resilient-redis';

export interface WindowHit {
  /** Hits in the current window, including this one. */
  count: number;
  /** Milliseconds until the window resets. */
  resetMs: number;
}

/**
 * INCR + set the expiry on the first hit, atomically (Lua runs as one Redis command),
 * so concurrent requests from several API instances share one exact counter.
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}`;

const MAX_MEMORY_KEYS = 50_000;

/**
 * Fixed-window counters and TTL flags in Redis, shared by every API instance.
 * When Redis is unavailable it keeps working with per-process memory: limits become
 * per-instance (less exact) instead of disappearing — protection degrades, it does not switch off.
 */
@Injectable()
export class CounterStore {
  private readonly memory = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly redis: ResilientRedis) {}

  async hit(key: string, windowMs: number): Promise<WindowHit> {
    const result = await this.redis.run(
      (r) => r.eval(HIT_SCRIPT, 1, key, windowMs) as Promise<[number, number]>,
    );
    if (result !== UNAVAILABLE) return { count: Number(result[0]), resetMs: Number(result[1]) };
    return this.memoryHit(key, windowMs);
  }

  /** Remaining lifetime of a flag key in ms, 0 when absent. */
  async ttl(key: string): Promise<number> {
    const result = await this.redis.run((r) => r.pttl(key));
    if (result !== UNAVAILABLE) return Math.max(0, result);
    const entry = this.memory.get(key);
    return entry ? Math.max(0, entry.expiresAt - Date.now()) : 0;
  }

  async setFlag(key: string, ttlMs: number): Promise<void> {
    const result = await this.redis.run((r) => r.set(key, '1', 'PX', ttlMs));
    if (result === UNAVAILABLE) this.memory.set(key, { count: 1, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    await this.redis.run((r) => r.del(key));
    this.memory.delete(key);
  }

  private memoryHit(key: string, windowMs: number): WindowHit {
    const now = Date.now();
    let entry = this.memory.get(key);
    if (!entry || entry.expiresAt <= now) {
      if (this.memory.size >= MAX_MEMORY_KEYS) this.prune(now);
      entry = { count: 0, expiresAt: now + windowMs };
      this.memory.set(key, entry);
    }
    entry.count += 1;
    return { count: entry.count, resetMs: entry.expiresAt - now };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.memory) if (entry.expiresAt <= now) this.memory.delete(key);
    // Still full (an attack with many distinct keys): drop the oldest half rather than grow forever.
    if (this.memory.size >= MAX_MEMORY_KEYS) {
      let drop = Math.floor(this.memory.size / 2);
      for (const key of this.memory.keys()) {
        if (drop-- <= 0) break;
        this.memory.delete(key);
      }
    }
  }
}
