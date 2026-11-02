import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class TrackingRepository {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Owner of the order, or null when it does not exist. */
  async ownerOf(orderId: string): Promise<string | null> {
    const rows: { user_id: string }[] = await this.db.query(
      'SELECT user_id FROM orders WHERE id = $1',
      [orderId],
    );
    return rows[0]?.user_id ?? null;
  }
}
