import Redis from 'ioredis';
import { ResilientRedis, UNAVAILABLE, Unavailable } from '../resilient-redis';

/**
 * Just enough of Redis in memory for unit tests of the cache and rate limiting:
 * strings with TTL, SET NX, INCR, MGET, hashes, pipelines and the counter Lua script.
 */
export class FakeRedis {
  readonly store = new Map<string, { value: string; expiresAt?: number }>();
  readonly hashes = new Map<string, Map<string, number>>();
  now = 0;

  private alive(key: string) {
    const entry = this.store.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= this.now) this.store.delete(key);
    return this.store.get(key);
  }

  get = jest.fn(async (key: string) => this.alive(key)?.value ?? null);

  set = jest.fn(async (key: string, value: string, ...args: (string | number)[]) => {
    if (args.includes('NX') && this.alive(key)) return null;
    let expiresAt: number | undefined;
    const ex = args.indexOf('EX');
    const px = args.indexOf('PX');
    if (ex >= 0) expiresAt = this.now + Number(args[ex + 1]) * 1000;
    if (px >= 0) expiresAt = this.now + Number(args[px + 1]);
    this.store.set(key, { value, expiresAt });
    return 'OK';
  });

  del = jest.fn(async (...keys: string[]) => {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed++;
    return removed;
  });

  incr = jest.fn(async (key: string) => {
    const next = Number(this.alive(key)?.value ?? 0) + 1;
    const expiresAt = this.store.get(key)?.expiresAt;
    this.store.set(key, { value: String(next), expiresAt });
    return next;
  });

  pttl = jest.fn(async (key: string) => {
    const entry = this.alive(key);
    if (!entry) return -2;
    return entry.expiresAt === undefined ? -1 : entry.expiresAt - this.now;
  });

  mget = jest.fn(async (...keys: string[]) => keys.map((key) => this.alive(key)?.value ?? null));

  hincrby = jest.fn(async (key: string, field: string, by: number) => {
    const hash = this.hashes.get(key) ?? new Map<string, number>();
    hash.set(field, (hash.get(field) ?? 0) + by);
    this.hashes.set(key, hash);
    return hash.get(field);
  });

  hgetall = jest.fn(async (key: string) =>
    Object.fromEntries([...(this.hashes.get(key) ?? new Map())].map(([k, v]) => [k, String(v)])),
  );

  /** The fixed-window counter script used by CounterStore. */
  eval = jest.fn(async (_script: string, _keys: number, key: string, windowMs: number) => {
    const count = await this.incr(key);
    if (count === 1) this.store.get(key)!.expiresAt = this.now + Number(windowMs);
    return [count, (this.store.get(key)!.expiresAt ?? this.now) - this.now];
  });

  pipeline() {
    const ops: (() => Promise<unknown>)[] = [];
    const chain = {
      set: (...args: Parameters<FakeRedis['set']>) => {
        ops.push(() => this.set(...args));
        return chain;
      },
      exec: async () => Promise.all(ops.map((op) => op())),
    };
    return chain;
  }
}

/** A ResilientRedis wired to the fake; `down = true` simulates an outage (every call UNAVAILABLE). */
export function resilientFake(fake = new FakeRedis()) {
  const control = { down: false };
  const resilient = {
    state: 'closed',
    run: async <T>(operation: (client: Redis) => Promise<T>): Promise<T | Unavailable> =>
      control.down ? UNAVAILABLE : operation(fake as unknown as Redis),
  } as unknown as ResilientRedis;
  return { fake, resilient, control };
}
