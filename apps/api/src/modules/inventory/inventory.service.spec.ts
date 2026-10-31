import { Role } from '../../common/auth/role.enum';
import { TransactionRunner } from '../../infra/database/transaction-runner';
import { ProductCache } from '../catalog/product-cache';
import { InventoryRepository, StockLevel } from './inventory.repository';
import { InventoryService } from './inventory.service';

const actor = { id: 'w1', email: 'kho@example.com', role: Role.WAREHOUSE };
const level: StockLevel = {
  productId: 'p1',
  sku: 'SKU-00001',
  name: 'Loa',
  quantity: 12,
  version: 2,
  updatedAt: new Date(),
};

function setup() {
  const repo = {
    findBySku: jest.fn().mockResolvedValue(level),
    findByProductId: jest.fn().mockResolvedValue(level),
    setQuantity: jest.fn().mockResolvedValue({ previous: 10 }),
    recordMovements: jest.fn(),
  };
  const tx = { run: jest.fn((work: (t: unknown) => Promise<unknown>) => work('TX')) };
  const productCache = { stockChanged: jest.fn() };
  return {
    service: new InventoryService(
      repo as unknown as InventoryRepository,
      tx as unknown as TransactionRunner,
      productCache as unknown as ProductCache,
    ),
    repo,
    productCache,
  };
}

describe('InventoryService', () => {
  it('looks up stock by SKU case-insensitively', async () => {
    const { service, repo } = setup();

    await service.getBySku(' sku-00001 ');

    expect(repo.findBySku).toHaveBeenCalledWith('SKU-00001');
  });

  it('reports an unknown SKU', async () => {
    const { service, repo } = setup();
    repo.findBySku.mockResolvedValue(null);

    await expect(service.getBySku('nope')).rejects.toMatchObject({
      response: { code: 'STOCK_NOT_FOUND' },
    });
  });

  it('records the difference of a stock count as an ADJUST movement', async () => {
    const { service, repo, productCache } = setup();

    await service.setQuantity(actor, 'p1', 12);

    expect(repo.setQuantity).toHaveBeenCalledWith('TX', 'p1', 12);
    expect(repo.recordMovements).toHaveBeenCalledWith('TX', [
      { productId: 'p1', delta: 2, reason: 'ADJUST', actorId: 'w1' },
    ]);
    expect(productCache.stockChanged).toHaveBeenCalledWith(['p1']);
  });

  it('writes no movement when the count did not change', async () => {
    const { service, repo } = setup();
    repo.setQuantity.mockResolvedValue({ previous: 12 });

    await service.setQuantity(actor, 'p1', 12);

    expect(repo.recordMovements).not.toHaveBeenCalled();
  });

  it('reports an unknown product', async () => {
    const { service, repo } = setup();
    repo.setQuantity.mockResolvedValue(null);

    await expect(service.setQuantity(actor, 'p9', 1)).rejects.toMatchObject({
      response: { code: 'STOCK_NOT_FOUND' },
    });
  });
});
