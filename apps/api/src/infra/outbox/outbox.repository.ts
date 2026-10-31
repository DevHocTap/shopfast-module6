import { Injectable } from '@nestjs/common';
import { Tx } from '../database/transaction-runner';

/** Facts other parts of the system react to asynchronously (emails, invoices, partner sync). */
export type OutboxEvent =
  | { type: 'OrderPlaced'; aggregateId: string; payload: { orderId: string } }
  | {
      type: 'InventoryChanged';
      aggregateId: string;
      payload: { productIds: string[]; reason: string };
    };

/**
 * Transactional outbox: events are inserted with the business change, in the SAME transaction.
 * Either both are committed or neither — an order can never exist without its follow-up work,
 * even if Redis/BullMQ is down at that moment. The worker's OutboxRelay publishes them later.
 */
@Injectable()
export class OutboxRepository {
  async add(tx: Tx, events: OutboxEvent[]): Promise<void> {
    if (events.length === 0) return;
    const params: unknown[] = [];
    const values = events.map((event, index) => {
      params.push(event.type, event.aggregateId, JSON.stringify(event.payload));
      return `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`;
    });
    await tx.query(
      `INSERT INTO outbox_events (event_type, aggregate_id, payload) VALUES ${values.join(', ')}`,
      params,
    );
  }
}
