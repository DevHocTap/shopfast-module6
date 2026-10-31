import { CartLine, CartRepository } from './cart.repository';
import { CartService, toView } from './cart.service';

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  productId: 'p1',
  sku: 'SKU-1',
  name: 'Chuột',
  unitPrice: 150_000,
  quantity: 2,
  isActive: true,
  stock: 5,
  ...overrides,
});

function setup() {
  const repo = {
    lines: jest.fn().mockResolvedValue([line()]),
    productIsActive: jest.fn().mockResolvedValue(true),
    upsert: jest.fn(),
    remove: jest.fn(),
  };
  return { service: new CartService(repo as unknown as CartRepository), repo };
}

describe('CartService', () => {
  it('computes line totals, item count and subtotal', () => {
    const view = toView([line(), line({ productId: 'p2', unitPrice: 50_000, quantity: 1 })]);

    expect(view.items[0].lineTotal).toBe(300_000);
    expect(view.itemCount).toBe(3);
    expect(view.subtotal).toBe(350_000);
    expect(view.hasUnavailableItems).toBe(false);
  });

  it('flags lines that cannot be fulfilled right now', () => {
    const view = toView([line({ quantity: 6 }), line({ productId: 'p2', isActive: false })]);

    expect(view.items.map((i) => i.available)).toEqual([false, false]);
    expect(view.hasUnavailableItems).toBe(true);
  });

  it('adds an active product and returns the refreshed cart', async () => {
    const { service, repo } = setup();

    const view = await service.setItem('u1', 'p1', 2);

    expect(repo.upsert).toHaveBeenCalledWith('u1', 'p1', 2);
    expect(view.items).toHaveLength(1);
  });

  it('refuses unknown or discontinued products', async () => {
    const { service, repo } = setup();
    repo.productIsActive.mockResolvedValue(false);

    await expect(service.setItem('u1', 'p9', 1)).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('removes a line', async () => {
    const { service, repo } = setup();

    await service.removeItem('u1', 'p1');

    expect(repo.remove).toHaveBeenCalledWith('u1', 'p1');
  });
});
