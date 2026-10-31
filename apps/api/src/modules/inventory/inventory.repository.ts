import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returningRows, Tx } from '../../infra/database/transaction-runner';

export type InventoryReason = 'ORDER' | 'CANCEL' | 'ADJUST' | 'SYNC' | 'SEED';

export interface InventoryMovement {
  productId: string;
  delta: number;
  reason: InventoryReason;
  refId?: string;
  actorId?: string;
}

export interface StockLevel {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  version: number;
  updatedAt: Date;
}

@Injectable()
export class InventoryRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Atomic conditional decrement. Two concurrent orders can never both take the last unit:
   * the row lock serialises them and the second one sees `quantity >= n` as false.
   * Returns false when stock is insufficient (nothing changed).
   */
  async reserve(tx: Tx, productId: string, quantity: number): Promise<boolean> {
    const rows = await returningRows<{ quantity: number }>(
      tx,
      `UPDATE inventories
          SET quantity = quantity - $2, version = version + 1, updated_at = now()
        WHERE product_id = $1 AND quantity >= $2
        RETURNING quantity`,
      [productId, quantity],
    );
    return rows.length === 1;
  }

  async release(tx: Tx, productId: string, quantity: number): Promise<void> {
    await tx.query(
      `UPDATE inventories
          SET quantity = quantity + $2, version = version + 1, updated_at = now()
        WHERE product_id = $1`,
      [productId, quantity],
    );
  }

  /** Sets an absolute quantity and returns the previous one, or null when the product is unknown. */
  async setQuantity(
    tx: Tx,
    productId: string,
    quantity: number,
  ): Promise<{ previous: number } | null> {
    const rows = await returningRows<{ previous: number }>(
      tx,
      `UPDATE inventories i
          SET quantity = $2, version = i.version + 1, updated_at = now()
         FROM (SELECT quantity FROM inventories WHERE product_id = $1 FOR UPDATE) old
        WHERE i.product_id = $1
        RETURNING old.quantity AS previous`,
      [productId, quantity],
    );
    return rows[0] ?? null;
  }

  async recordMovements(tx: Tx, movements: InventoryMovement[]): Promise<void> {
    if (movements.length === 0) return;
    const params: unknown[] = [];
    const values = movements.map((m, index) => {
      params.push(m.productId, m.delta, m.reason, m.refId ?? null, m.actorId ?? null);
      const base = index * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    await tx.query(
      `INSERT INTO inventory_movements (product_id, delta, reason, ref_id, actor_id)
       VALUES ${values.join(', ')}`,
      params,
    );
  }

  async findBySku(sku: string): Promise<StockLevel | null> {
    const rows: StockLevel[] = await this.dataSource.query(
      `SELECT p.id AS "productId", p.sku, p.name, i.quantity, i.version, i.updated_at AS "updatedAt"
         FROM products p JOIN inventories i ON i.product_id = p.id
        WHERE p.sku = $1`,
      [sku],
    );
    return rows[0] ?? null;
  }

  async findByProductId(productId: string): Promise<StockLevel | null> {
    const rows: StockLevel[] = await this.dataSource.query(
      `SELECT p.id AS "productId", p.sku, p.name, i.quantity, i.version, i.updated_at AS "updatedAt"
         FROM products p JOIN inventories i ON i.product_id = p.id
        WHERE p.id = $1`,
      [productId],
    );
    return rows[0] ?? null;
  }
}
