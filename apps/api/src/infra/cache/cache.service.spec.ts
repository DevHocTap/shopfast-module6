import { resilientFake } from '../redis/testing/fake-redis';
import { CacheService, SECOND_DELETE_DELAY_MS, withJitter } from './cache.service';

function setup() {
  const { fake, resilient, control } = resilientFake();
  return { cache: new CacheService(resilient), fake, control };
}

describe('CacheService', () => {
  it('loads on a miss, stores the value, then serves it from Redis', async () => {
    const { cache } = setup();
    const loader = jest.fn().mockResolvedValue({ price: 100 });

    const first = await cache.getOrLoad('product:1', 600, loader);
    const second = await cache.getOrLoad('product:1', 600, loader);

    expect(first).toEqual({ value: { price: 100 }, status: 'MISS' });
    expect(second).toEqual({ value: { price: 100 }, status: 'HIT' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('caches "not found" so probing unknown ids does not reach the database again', async () => {
    const { cache, fake } = setup();
    const loader = jest.fn().mockResolvedValue(null);

    await cache.getOrLoad('product:nope', 600, loader, 60);
    const again = await cache.getOrLoad('product:nope', 600, loader, 60);

    expect(again).toEqual({ value: null, status: 'HIT' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(fake.store.get('product:nope')?.expiresAt).toBe(60_000);
  });

  it('runs the loader once for 100 concurrent misses on the same key (no stampede)', async () => {
    const { cache } = setup();
    let release!: (value: string) => void;
    const loader = jest.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const pending = Array.from({ length: 100 }, () => cache.getOrLoad('hot', 60, loader));
    await new Promise((resolve) => setImmediate(resolve));
    release('fresh');
    const results = await Promise.all(pending);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.value === 'fresh')).toBe(true);
  });

  it('waits for another instance that holds the lock instead of querying the database', async () => {
    const { cache, fake } = setup();
    await fake.set('lock:hot', '1', 'PX', 3000, 'NX'); // another API instance is loading
    setTimeout(() => void fake.set('hot', JSON.stringify('from-other-instance'), 'EX', 60), 60);
    const loader = jest.fn().mockResolvedValue('from-db');

    const result = await cache.getOrLoad('hot', 60, loader);

    expect(result.value).toBe('from-other-instance');
    expect(loader).not.toHaveBeenCalled();
  });

  it('serves from the loader when Redis is down (BYPASS), without failing the request', async () => {
    const { cache, control } = setup();
    control.down = true;

    await expect(cache.getOrLoad('product:1', 600, async () => 'db-value')).resolves.toEqual({
      value: 'db-value',
      status: 'BYPASS',
    });
  });

  it('deletes again shortly after invalidation to evict a value written by a racing reader', async () => {
    jest.useFakeTimers();
    const { cache, fake } = setup();
    await fake.set('product:1', '"old"');

    await cache.invalidate('product:1');
    await fake.set('product:1', '"stale-from-race"');
    jest.advanceTimersByTime(SECOND_DELETE_DELAY_MS);
    await Promise.resolve();
    jest.useRealTimers();

    expect(fake.del).toHaveBeenCalledTimes(2);
    expect(fake.store.has('product:1')).toBe(false);
  });

  it('versions namespaces: bumping makes old list keys unreachable', async () => {
    const { cache } = setup();

    expect(await cache.version('catalog')).toBe(0);
    await cache.bumpVersion('catalog');
    expect(await cache.version('catalog')).toBe(1);
  });

  it('reads and writes many small values in one round-trip', async () => {
    const { cache } = setup();

    await cache.setMany([{ key: 'stock:a', value: 3 }], 60);
    await expect(cache.getMany<number>(['stock:a', 'stock:b'])).resolves.toEqual([3, undefined]);
  });

  it('reports the hit ratio across instances', async () => {
    const { cache } = setup();
    const loader = async () => 1;
    await cache.getOrLoad('k', 60, loader);
    await cache.getOrLoad('k', 60, loader);
    await cache.getOrLoad('k', 60, loader);
    await cache.getOrLoad('k', 60, loader);

    await expect(cache.stats()).resolves.toMatchObject({ hits: 3, misses: 1, hitRatio: 0.75 });
    await cache.resetStats();
  });

  it('spreads expirations by ±10%', () => {
    expect(withJitter(600, () => 0)).toBe(540);
    expect(withJitter(600, () => 1)).toBe(660);
  });
});
