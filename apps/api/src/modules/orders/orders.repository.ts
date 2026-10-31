import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tx } from '../../infra/database/transaction-runner';
import { OrderStatus } from './order-state-machine';

export const IDEMPOTENCY_CONSTRAINT = 'orders_user_idempotency_key';

export interface NewOrder {
  code: string;
  userId: string;
  subtotal: number;
  total: number;
  idempotencyKey: string;
}

export interface NewOrderItem {
  productId: string;
  productName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

/** The fields needed to decide a state change, read under a row lock. */
export interface OrderHead {
  id: string;
  userId: string;
  status: OrderStatus;
  version: number;
  total: number;
}

export interface OrderSummary {
  id: string;
  code: string;
  status: OrderStatus;
  total: number;
  itemCount: number;
  /** Optimistic-lock version: send it back when changing the status. */
  version: number;
  createdAt: Date;
  customer: { id: string; email: string; fullName: string };
}

export interface OrderDetail extends OrderSummary {
  subtotal: number;
  discount: number;
  updatedAt: Date;
  items: (NewOrderItem & { lineTotal: number })[];
  history: { from: OrderStatus | null; to: OrderStatus; at: Date }[];
  payment: { amount: number; method: string; paidAt: Date } | null;
}

const SUMMARY_SELECT = `
  SELECT o.id, o.code, o.status, o.total, o.subtotal, o.discount, o.version,
         o.created_at, o.updated_at,
         u.id AS customer_id, u.email AS customer_email, u.full_name AS customer_name,
         (SELECT COALESCE(sum(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM orders o JOIN users u ON u.id = o.user_id`;

interface RawSummary {
  id: string;
  code: string;
  status: OrderStatus;
  total: string;
  subtotal: string;
  discount: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  item_count: string;
  total_count?: string;
}

@Injectable()
export class OrdersRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findIdByIdempotencyKey(userId: string, key: string): Promise<string | null> {
    const rows: { id: string }[] = await this.dataSource.query(
      'SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2',
      [userId, key],
    );
    return rows[0]?.id ?? null;
  }

  async insertOrder(tx: Tx, order: NewOrder): Promise<string> {
    const rows: { id: string }[] = await tx.query(
      `INSERT INTO orders (code, user_id, subtotal, total, idempotency_key)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [order.code, order.userId, order.subtotal, order.total, order.idempotencyKey],
    );
    return rows[0].id;
  }

  async insertItems(tx: Tx, orderId: string, items: NewOrderItem[]): Promise<void> {
    const params: unknown[] = [];
    const values = items.map((item, index) => {
      params.push(
        orderId,
        item.productId,
        item.productName,
        item.sku,
        item.unitPrice,
        item.quantity,
      );
      const b = index * 6;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
    });
    await tx.query(
      `INSERT INTO order_items (order_id, product_id, product_name, sku, unit_price, quantity)
       VALUES ${values.join(', ')}`,
      params,
    );
  }

  async insertHistory(
    tx: Tx,
    orderId: string,
    from: OrderStatus | null,
    to: OrderStatus,
    actorId: string,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, actor_id)
       VALUES ($1, $2, $3, $4)`,
      [orderId, from, to, actorId],
    );
  }

  /** SELECT … FOR UPDATE: concurrent status changes on one order are serialised. */
  async lock(tx: Tx, orderId: string): Promise<OrderHead | null> {
    const rows: {
      id: string;
      user_id: string;
      status: OrderStatus;
      version: number;
      total: string;
    }[] = await tx.query(
      'SELECT id, user_id, status, version, total FROM orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          status: row.status,
          version: row.version,
          total: Number(row.total),
        }
      : null;
  }

  async items(tx: Tx, orderId: string): Promise<{ productId: string; quantity: number }[]> {
    const rows: { product_id: string; quantity: number }[] = await tx.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id',
      [orderId],
    );
    return rows.map((r) => ({ productId: r.product_id, quantity: r.quantity }));
  }

  async updateStatus(tx: Tx, orderId: string, status: OrderStatus): Promise<void> {
    await tx.query(
      `UPDATE orders SET status = $2, version = version + 1, updated_at = now() WHERE id = $1`,
      [orderId, status],
    );
  }

  async insertPayment(tx: Tx, orderId: string, amount: number, method: string): Promise<void> {
    await tx.query('INSERT INTO payments (order_id, amount, method) VALUES ($1, $2, $3)', [
      orderId,
      amount,
      method,
    ]);
  }

  async detail(orderId: string): Promise<OrderDetail | null> {
    const [head]: RawSummary[] = await this.dataSource.query(`${SUMMARY_SELECT} WHERE o.id = $1`, [
      orderId,
    ]);
    if (!head) return null;

    const itemsQuery: Promise<
      {
        product_id: string;
        product_name: string;
        sku: string;
        unit_price: string;
        quantity: number;
      }[]
    > = this.dataSource.query(
      `SELECT product_id, product_name, sku, unit_price, quantity
         FROM order_items WHERE order_id = $1 ORDER BY product_name`,
      [orderId],
    );
    const historyQuery: Promise<
      { from_status: OrderStatus | null; to_status: OrderStatus; created_at: Date }[]
    > = this.dataSource.query(
      `SELECT from_status, to_status, created_at FROM order_status_history
        WHERE order_id = $1 ORDER BY id`,
      [orderId],
    );
    const paymentQuery: Promise<{ amount: string; method: string; paid_at: Date }[]> =
      this.dataSource.query('SELECT amount, method, paid_at FROM payments WHERE order_id = $1', [
        orderId,
      ]);
    const [items, history, payments] = await Promise.all([itemsQuery, historyQuery, paymentQuery]);

    return {
      ...toSummary(head),
      subtotal: Number(head.subtotal),
      discount: Number(head.discount),
      updatedAt: head.updated_at,
      items: items.map((i) => ({
        productId: i.product_id,
        productName: i.product_name,
        sku: i.sku,
        unitPrice: Number(i.unit_price),
        quantity: i.quantity,
        lineTotal: Number(i.unit_price) * i.quantity,
      })),
      history: history.map((h) => ({ from: h.from_status, to: h.to_status, at: h.created_at })),
      payment: payments[0]
        ? {
            amount: Number(payments[0].amount),
            method: payments[0].method,
            paidAt: payments[0].paid_at,
          }
        : null,
    };
  }

  async list(
    filter: { userId?: string; status?: OrderStatus },
    offset: number,
    limit: number,
  ): Promise<{ rows: OrderSummary[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.userId) {
      params.push(filter.userId);
      where.push(`o.user_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`o.status = $${params.length}`);
    }
    params.push(limit, offset);
    const rows: RawSummary[] = await this.dataSource.query(
      `${SUMMARY_SELECT.replace('SELECT o.id', 'SELECT count(*) OVER () AS total_count, o.id')}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY o.created_at DESC, o.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows: rows.map(toSummary), total: rows.length ? Number(rows[0].total_count) : 0 };
  }
}

function toSummary(r: RawSummary): OrderSummary {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    total: Number(r.total),
    itemCount: Number(r.item_count),
    version: r.version,
    createdAt: r.created_at,
    customer: { id: r.customer_id, email: r.customer_email, fullName: r.customer_name },
  };
}
