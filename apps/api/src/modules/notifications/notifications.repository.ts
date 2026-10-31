import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderEmailData } from './email-templates';

export interface OrderForEmail extends OrderEmailData {
  id: string;
  status: string;
}

/** Read model for background jobs: just what emails and invoices need, in two queries. */
@Injectable()
export class NotificationsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async order(orderId: string): Promise<OrderForEmail | null> {
    const [head]: {
      id: string;
      code: string;
      status: string;
      total: string;
      discount: string;
      email: string;
      full_name: string;
    }[] = await this.dataSource.query(
      `SELECT o.id, o.code, o.status, o.total, o.discount, u.email, u.full_name
         FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [orderId],
    );
    if (!head) return null;
    const items: { product_name: string; quantity: number; unit_price: string }[] =
      await this.dataSource.query(
        'SELECT product_name, quantity, unit_price FROM order_items WHERE order_id = $1 ORDER BY product_name',
        [orderId],
      );
    return {
      id: head.id,
      code: head.code,
      status: head.status,
      total: Number(head.total),
      discount: Number(head.discount),
      customerEmail: head.email,
      customerName: head.full_name,
      items: items.map((item) => ({
        name: item.product_name,
        quantity: item.quantity,
        lineTotal: Number(item.unit_price) * item.quantity,
      })),
    };
  }

  async adminEmails(): Promise<string[]> {
    const rows: { email: string }[] = await this.dataSource.query(
      `SELECT email FROM users WHERE role = 'ADMIN' ORDER BY email`,
    );
    return rows.map((row) => row.email);
  }
}
