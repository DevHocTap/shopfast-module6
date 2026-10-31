import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class InvoicesRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async exists(orderId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      'SELECT 1 FROM invoices WHERE order_id = $1',
      [orderId],
    );
    return rows.length > 0;
  }

  /** UNIQUE(order_id): a duplicated job can never create a second invoice. Returns false if one existed. */
  async insert(orderId: string, invoiceNumber: string, html: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `INSERT INTO invoices (order_id, invoice_number, html) VALUES ($1, $2, $3)
       ON CONFLICT (order_id) DO NOTHING RETURNING id`,
      [orderId, invoiceNumber, html],
    );
    return rows.length > 0;
  }

  async findByOrder(orderId: string): Promise<{ invoiceNumber: string; html: string } | null> {
    const [row]: { invoice_number: string; html: string }[] = await this.dataSource.query(
      'SELECT invoice_number, html FROM invoices WHERE order_id = $1',
      [orderId],
    );
    return row ? { invoiceNumber: row.invoice_number, html: row.html } : null;
  }
}
