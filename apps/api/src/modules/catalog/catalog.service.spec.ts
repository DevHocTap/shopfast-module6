import { CatalogRepository, ProductRow } from './catalog.repository';
import { CatalogService } from './catalog.service';
import { ProductQueryDto } from './dto/catalog.dto';

const row = (overrides: Partial<ProductRow> = {}): ProductRow => ({
  id: 'p1',
  sku: 'SKU-1',
  name: 'Laptop',
  description: '',
  price: 20_000_000,
  isActive: true,
  version: 1,
  stock: 3,
  category: { id: 'c1', name: 'Laptop' },
  brand: { id: 'b1', name: 'Dell' },
  ...overrides,
});

const query = (overrides: Partial<ProductQueryDto> = {}): ProductQueryDto =>
  Object.assign(new ProductQueryDto(), { page: 1, limit: 20, sort: 'newest' }, overrides);

function setup() {
  const repo = {
    search: jest.fn().mockResolvedValue({ rows: [row(), row({ id: 'p2', stock: 0 })], total: 42 }),
    findById: jest.fn().mockResolvedValue(row()),
    categories: jest.fn().mockResolvedValue([]),
    brands: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ id: 'p1' }),
  };
  return { service: new CatalogService(repo as unknown as CatalogRepository), repo };
}

describe('CatalogService', () => {
  it('translates page/limit into offset and reports stock availability', async () => {
    const { service, repo } = setup();

    const result = await service.listProducts(
      query({ page: 3, limit: 20, categoryId: 'c1', q: '' }),
    );

    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 40, limit: 20, categoryId: 'c1', q: undefined }),
    );
    expect(result).toMatchObject({ total: 42, totalPages: 3, page: 3 });
    expect(result.items.map((p) => p.inStock)).toEqual([true, false]);
  });

  it('rejects an inverted price range', async () => {
    const { service } = setup();

    await expect(
      service.listProducts(query({ minPrice: 500, maxPrice: 100 })),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_PRICE_RANGE' },
    });
  });

  it('hides unknown and discontinued products', async () => {
    const { service, repo } = setup();

    repo.findById.mockResolvedValueOnce(null);
    await expect(service.getProduct('x')).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });

    repo.findById.mockResolvedValueOnce(row({ isActive: false }));
    await expect(service.getProduct('p1')).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
  });

  it('updates a product and returns the fresh view', async () => {
    const { service, repo } = setup();

    await expect(service.updateProduct('p1', { price: 19_000_000 })).resolves.toMatchObject({
      id: 'p1',
    });
    expect(repo.update).toHaveBeenCalledWith('p1', { price: 19_000_000 });

    repo.update.mockResolvedValueOnce(null);
    await expect(service.updateProduct('nope', { price: 1 })).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
  });

  it('lists categories and brands', async () => {
    const { service, repo } = setup();

    await service.listCategories();
    await service.listBrands();

    expect(repo.categories).toHaveBeenCalled();
    expect(repo.brands).toHaveBeenCalled();
  });
});
