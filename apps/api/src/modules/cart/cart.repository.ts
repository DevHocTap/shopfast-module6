import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tx } from '../../infra/database/transaction-runner';

export interface CartLine {
  productId: string;
  sku: string;
  name: string;
  /** Current catalog price, read from the database (never from the client or a cache). */
  unitPrice: number;
  quantity: number;
  isActive: boolean;
  stock: number;
}

interface RawCartLine {
  product_id: string;
  sku: string;
  name: string;
  price: string;
  quantity: number;
  is_active: boolean;
  stock: number | null;
}

@Injectable()
export class CartRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Lines ordered by product id: the order in which stock rows are locked at checkout. */
  async lines(userId: string, tx?: Tx): Promise<CartLine[]> {
    const runner = tx ?? this.dataSource.manager;
    const rows: RawCartLine[] = await runner.query(
      `SELECT ci.product_id, p.sku, p.name, p.price, ci.quantity, p.is_active,
              COALESCE(i.quantity, 0) AS stock
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         LEFT JOIN inventories i ON i.product_id = ci.product_id
        WHERE ci.user_id = $1
        ORDER BY ci.product_id`,
      [userId],
    );
    return rows.map((r) => ({
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      unitPrice: Number(r.price),
      quantity: r.quantity,
      isActive: r.is_active,
      stock: Number(r.stock ?? 0),
    }));
  }

  async productIsActive(productId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      'SELECT 1 FROM products WHERE id = $1 AND is_active',
      [productId],
    );
    return rows.length === 1;
  }

  async upsert(userId: string, productId: string, quantity: number): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
      [userId, productId, quantity],
    );
  }

  async remove(userId: string, productId: string): Promise<void> {
    await this.dataSource.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [
      userId,
      productId,
    ]);
  }

  async clear(tx: Tx, userId: string): Promise<void> {
    await tx.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
  }
}
