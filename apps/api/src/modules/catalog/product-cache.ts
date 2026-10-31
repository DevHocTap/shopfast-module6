import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CacheService } from '../../infra/cache/cache.service';
import { CatalogRepository } from './catalog.repository';

export const PRODUCT_TTL_SECONDS = 600;
export const LIST_TTL_SECONDS = 300;
export const STOCK_TTL_SECONDS = 60;
export const FACETS_TTL_SECONDS = 3600;
export const CATALOG_NAMESPACE = 'catalog';

export const productKey = (id: string) => `product:${id}`;
export const stockKey = (id: string) => `stock:${id}`;

/** Same filter in any order / with empty values → same key, so equivalent searches share a cache entry. */
export function listKey(version: number, filter: Record<string, unknown>): string {
  const normalized = Object.keys(filter)
    .filter((key) => filter[key] !== undefined && filter[key] !== '')
    .sort()
    .map((key) => `${key}=${String(filter[key])}`)
    .join('&');
  return `catalog:list:v${version}:${createHash('sha1').update(normalized).digest('hex')}`;
}

/**
 * Cache keys of the catalog and their invalidation rules — the single place other modules call
 * after they COMMIT a change:
 *   price / name / active flag changed → drop product:{id} and bump the list version
 *   stock changed (order, cancel, stock count) → drop stock:{id} only (lists stay cached)
 */
@Injectable()
export class ProductCache {
  constructor(
    private readonly cache: CacheService,
    private readonly repo: CatalogRepository,
  ) {}

  /** Stock for each id: from Redis when present, the rest from one DB query (then cached). */
  async stocks(productIds: string[]): Promise<Map<string, number>> {
    const cached = await this.cache.getMany<number>(productIds.map(stockKey));
    const result = new Map<string, number>();
    const missing: string[] = [];
    productIds.forEach((id, index) => {
      const value = cached[index];
      if (value === undefined) missing.push(id);
      else result.set(id, value);
    });
    if (missing.length > 0) {
      const fresh = await this.repo.stocks(missing);
      for (const id of missing) result.set(id, fresh.get(id) ?? 0);
      await this.cache.setMany(
        missing.map((id) => ({ key: stockKey(id), value: fresh.get(id) ?? 0 })),
        STOCK_TTL_SECONDS,
      );
    }
    return result;
  }

  async productChanged(productId: string): Promise<void> {
    await this.cache.invalidate(productKey(productId), stockKey(productId));
    await this.cache.bumpVersion(CATALOG_NAMESPACE);
  }

  async stockChanged(productIds: string[]): Promise<void> {
    await this.cache.invalidate(...productIds.map(stockKey));
  }
}
