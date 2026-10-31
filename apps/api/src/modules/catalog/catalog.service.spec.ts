import { CacheService } from '../../infra/cache/cache.service';
import { resilientFake } from '../../infra/redis/testing/fake-redis';
import { CatalogRepository, ProductInfo } from './catalog.repository';
import { CatalogService } from './catalog.service';
import { ProductQueryDto } from './dto/catalog.dto';
import { listKey, ProductCache } from './product-cache';

const info = (overrides: Partial<ProductInfo> = {}): ProductInfo => ({
  id: 'p1',
  sku: 'SKU-1',
  name: 'Laptop',
  description: '',
  price: 20_000_000,
  isActive: true,
  version: 1,
  category: { id: 'c1', name: 'Laptop' },
  brand: { id: 'b1', name: 'Dell' },
  ...overrides,
});

const query = (overrides: Partial<ProductQueryDto> = {}): ProductQueryDto =>
  Object.assign(new ProductQueryDto(), { page: 1, limit: 20, sort: 'newest' }, overrides);

/** Real CacheService and ProductCache on an in-memory Redis; only the repository is mocked. */
function setup() {
  const { resilient, control } = resilientFake();
  const repo = {
    search: jest.fn().mockResolvedValue({ rows: [info(), info({ id: 'p2' })], total: 42 }),
    findById: jest.fn().mockResolvedValue(info()),
    stocks: jest.fn(
      async (ids: string[]): Promise<Map<string, number>> =>
        new Map(ids.map((id) => [id, id === 'p2' ? 0 : 3])),
    ),
    categories: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Laptop', slug: 'laptop' }]),
    brands: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ id: 'p1' }),
  };
  const cache = new CacheService(resilient);
  const productCache = new ProductCache(cache, repo as unknown as CatalogRepository);
  const service = new CatalogService(repo as unknown as CatalogRepository, cache, productCache);
  return { service, repo, control, productCache };
}

describe('CatalogService', () => {
  it('serves the second identical search from the cache and merges live stock', async () => {
    const { service, repo } = setup();

    const first = await service.listProducts(query({ page: 3, categoryId: 'c1' }));
    const second = await service.listProducts(query({ page: 3, categoryId: 'c1' }));

    expect(first.cache).toBe('MISS');
    expect(second.cache).toBe('HIT');
    expect(repo.search).toHaveBeenCalledTimes(1);
    expect(repo.search).toHaveBeenCalledWith(expect.objectContaining({ offset: 40, limit: 20 }));
    expect(second.data).toMatchObject({ total: 42, totalPages: 3, page: 3 });
    expect(second.data.items.map((p) => [p.stock, p.inStock])).toEqual([
      [3, true],
      [0, false],
    ]);
  });

  it('shows a new price immediately after an update (list version bump + product key drop)', async () => {
    const { service, repo } = setup();
    await service.listProducts(query());
    await service.getProduct('p1');

    repo.findById.mockResolvedValue(info({ price: 19_000_000 }));
    repo.search.mockResolvedValue({ rows: [info({ price: 19_000_000 })], total: 1 });
    await service.updateProduct('p1', { price: 19_000_000 });

    expect((await service.getProduct('p1')).data.price).toBe(19_000_000);
    const list = await service.listProducts(query());
    expect(list.cache).toBe('MISS');
    expect(list.data.items[0].price).toBe(19_000_000);
  });

  it('refreshes stock without throwing away the cached list', async () => {
    const { service, repo, productCache } = setup();
    await service.listProducts(query());

    repo.stocks.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, 1])));
    await productCache.stockChanged(['p1']);
    const after = await service.listProducts(query());

    expect(after.cache).toBe('HIT');
    expect(after.data.items[0].stock).toBe(1);
  });

  it('rejects an inverted price range', async () => {
    const { service } = setup();

    await expect(
      service.listProducts(query({ minPrice: 500, maxPrice: 100 })),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_PRICE_RANGE' },
    });
  });

  it('hides unknown and discontinued products, and caches the miss', async () => {
    const { service, repo } = setup();
    repo.findById.mockResolvedValue(null);

    await expect(service.getProduct('x')).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
    await expect(service.getProduct('x')).rejects.toBeDefined();
    expect(repo.findById).toHaveBeenCalledTimes(1);

    repo.findById.mockResolvedValue(info({ id: 'old', isActive: false }));
    await expect(service.getProduct('old')).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
  });

  it('keeps working from the database when Redis is down', async () => {
    const { service, control } = setup();
    control.down = true;

    const result = await service.getProduct('p1');

    expect(result.cache).toBe('BYPASS');
    expect(result.data.stock).toBe(3);
  });

  it('caches categories and brands', async () => {
    const { service, repo } = setup();
    await service.listCategories();
    await service.listCategories();
    await service.listBrands();

    expect(repo.categories).toHaveBeenCalledTimes(1);
    expect(repo.brands).toHaveBeenCalledTimes(1);
  });

  it('reports a missing product on update', async () => {
    const { service, repo } = setup();
    repo.update.mockResolvedValueOnce(null);

    await expect(service.updateProduct('nope', { price: 1 })).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
  });
});

describe('listKey', () => {
  it('gives the same key for the same filter regardless of order and empty values', () => {
    const a = listKey(3, { sort: 'newest', categoryId: 'c1', q: undefined, brandId: '' });
    const b = listKey(3, { categoryId: 'c1', sort: 'newest' });
    expect(a).toBe(b);
    expect(listKey(4, { categoryId: 'c1', sort: 'newest' })).not.toBe(a);
  });
});
