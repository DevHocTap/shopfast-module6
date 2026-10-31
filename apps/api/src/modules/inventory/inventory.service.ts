import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { AppError } from '../../common/errors/app-error';
import { TransactionRunner } from '../../infra/database/transaction-runner';
import { OutboxRepository } from '../../infra/outbox/outbox.repository';
import { ProductCache } from '../catalog/product-cache';
import { InventoryRepository, StockLevel } from './inventory.repository';

const stockNotFound = () =>
  new AppError(HttpStatus.NOT_FOUND, 'STOCK_NOT_FOUND', 'Không tìm thấy tồn kho của sản phẩm này.');

@Injectable()
export class InventoryService {
  constructor(
    private readonly repo: InventoryRepository,
    private readonly tx: TransactionRunner,
    private readonly productCache: ProductCache,
    private readonly outbox: OutboxRepository,
  ) {}

  async getBySku(sku: string): Promise<StockLevel> {
    const stock = await this.repo.findBySku(sku.trim().toUpperCase());
    if (!stock) throw stockNotFound();
    return stock;
  }

  /** Warehouse stock count: sets the real quantity and logs the difference as an ADJUST movement. */
  async setQuantity(actor: AuthUser, productId: string, quantity: number): Promise<StockLevel> {
    await this.tx.run(async (tx) => {
      const result = await this.repo.setQuantity(tx, productId, quantity);
      if (!result) throw stockNotFound();
      const delta = quantity - result.previous;
      if (delta !== 0) {
        await this.repo.recordMovements(tx, [
          { productId, delta, reason: 'ADJUST', actorId: actor.id },
        ]);
        await this.outbox.add(tx, [
          {
            type: 'InventoryChanged',
            aggregateId: productId,
            payload: { productIds: [productId], reason: 'ADJUST' },
          },
        ]);
      }
    });
    await this.productCache.stockChanged([productId]);
    const stock = await this.repo.findByProductId(productId);
    if (!stock) throw stockNotFound();
    return stock;
  }
}
