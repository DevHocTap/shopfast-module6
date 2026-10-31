import { Injectable } from '@nestjs/common';
import { ResilientRedis, UNAVAILABLE } from '../redis/resilient-redis';

/** HIT: served from Redis · MISS: loaded from the DB and stored · BYPASS: Redis unavailable. */
export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';

export interface Cached<T> {
  value: T | null;
  status: CacheStatus;
}

export interface CacheStats {
  hits: number;
  misses: number;
  bypasses: number;
  hitRatio: number;
  redis: string;
}

const NULL_MARKER = '__null__';
const STATS_KEY = 'cache:stats';
const LOCK_TTL_MS = 3000;
const LOCK_WAIT_STEP_MS = 50;
const LOCK_WAIT_STEPS = 6;
export const SECOND_DELETE_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** ±10% so keys written together do not all expire in the same second. */
export function withJitter(ttlSeconds: number, random: () => number = Math.random): number {
  return Math.max(1, Math.round(ttlSeconds * (0.9 + random() * 0.2)));
}

/**
 * Cache-aside on Redis with the protections required by F04:
 * - stampede: one loader per key per process (singleflight) and one per cluster (SET NX lock);
 *   the others wait briefly and read the freshly written value
 * - penetration: "not found" is cached too (short TTL), so probing unknown ids cannot hammer the DB
 * - availability: if Redis fails, values come straight from the loader (status BYPASS)
 */
@Injectable()
export class CacheService {
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: ResilientRedis) {}

  async getOrLoad<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T | null>,
    negativeTtlSeconds = 60,
  ): Promise<Cached<T>> {
    const cached = await this.redis.run((r) => r.get(key));
    if (cached === UNAVAILABLE) {
      this.count('bypasses');
      return { value: await loader(), status: 'BYPASS' };
    }
    if (cached !== null) {
      this.count('hits');
      return { value: decode<T>(cached), status: 'HIT' };
    }

    this.count('misses');
    const value = await this.singleflight(key, () =>
      this.loadWithLock(key, ttlSeconds, negativeTtlSeconds, loader),
    );
    return { value, status: 'MISS' };
  }

  /** Delete now and once more shortly after, to evict a stale value written by a racing reader. */
  async invalidate(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.redis.run((r) => r.del(...keys));
    setTimeout(() => void this.redis.run((r) => r.del(...keys)), SECOND_DELETE_DELAY_MS).unref();
  }

  /** Namespaced version counter: bumping it makes every key built on the old version unreachable. */
  async version(namespace: string): Promise<number> {
    const value = await this.redis.run((r) => r.get(`version:${namespace}`));
    return value === UNAVAILABLE || value === null ? 0 : Number(value);
  }

  async bumpVersion(namespace: string): Promise<void> {
    await this.redis.run((r) => r.incr(`version:${namespace}`));
  }

  /** Many small values in one round-trip; missing or unavailable entries come back as undefined. */
  async getMany<T>(keys: string[]): Promise<(T | undefined)[]> {
    if (keys.length === 0) return [];
    const values = await this.redis.run((r) => r.mget(...keys));
    if (values === UNAVAILABLE) return keys.map(() => undefined);
    return values.map((value) => (value === null ? undefined : (decode<T>(value) as T)));
  }

  async setMany(entries: { key: string; value: unknown }[], ttlSeconds: number): Promise<void> {
    if (entries.length === 0) return;
    await this.redis.run((r) => {
      const pipeline = r.pipeline();
      for (const { key, value } of entries)
        pipeline.set(key, encode(value), 'EX', withJitter(ttlSeconds));
      return pipeline.exec();
    });
  }

  async stats(): Promise<CacheStats> {
    const raw = await this.redis.run((r) => r.hgetall(STATS_KEY));
    const data = raw === UNAVAILABLE ? {} : raw;
    const hits = Number(data.hits ?? 0);
    const misses = Number(data.misses ?? 0);
    const bypasses = Number(data.bypasses ?? 0);
    const total = hits + misses + bypasses;
    return {
      hits,
      misses,
      bypasses,
      hitRatio: total === 0 ? 0 : Math.round((hits / total) * 1000) / 1000,
      redis: this.redis.state,
    };
  }

  async resetStats(): Promise<void> {
    await this.redis.run((r) => r.del(STATS_KEY));
  }

  private async loadWithLock<T>(
    key: string,
    ttlSeconds: number,
    negativeTtlSeconds: number,
    loader: () => Promise<T | null>,
  ): Promise<T | null> {
    const lockKey = `lock:${key}`;
    const acquired = await this.redis.run((r) => r.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX'));

    if (acquired === null) {
      // Another instance is loading this key right now: give it a moment instead of piling on the DB.
      for (let step = 0; step < LOCK_WAIT_STEPS; step++) {
        await sleep(LOCK_WAIT_STEP_MS);
        const value = await this.redis.run((r) => r.get(key));
        if (value === UNAVAILABLE) break;
        if (value !== null) return decode<T>(value);
      }
    }

    try {
      const value = await loader();
      const ttl = value === null ? negativeTtlSeconds : withJitter(ttlSeconds);
      await this.redis.run((r) => r.set(key, encode(value), 'EX', ttl));
      return value;
    } finally {
      if (acquired === 'OK') await this.redis.run((r) => r.del(lockKey));
    }
  }

  private singleflight<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = work().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private count(field: 'hits' | 'misses' | 'bypasses'): void {
    if (field === 'bypasses') return; // Redis is down: nowhere to count
    void this.redis.run((r) => r.hincrby(STATS_KEY, field, 1));
  }
}

function encode(value: unknown): string {
  return value === null ? NULL_MARKER : JSON.stringify(value);
}

function decode<T>(raw: string): T | null {
  return raw === NULL_MARKER ? null : (JSON.parse(raw) as T);
}
