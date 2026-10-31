import { jobId, QUEUES, QueueName } from '../queue/queue.constants';

export interface StoredEvent {
  id: string;
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface PlannedJob {
  queue: QueueName;
  name: string;
  data: Record<string, unknown>;
  jobId: string;
  delayMs?: number;
}

/**
 * Which jobs an event triggers. Pure function: the whole fan-out of the system is readable here.
 * Job ids are derived from the business ids, so publishing the same event twice enqueues nothing new.
 */
export function jobsFor(event: StoredEvent, paymentReminderDelayMs: number): PlannedJob[] {
  switch (event.type) {
    case 'OrderPlaced': {
      const orderId = String(event.payload.orderId);
      return [
        {
          queue: QUEUES.email,
          name: 'order-confirmation',
          data: { orderId },
          jobId: jobId('order-confirmation', orderId),
        },
        {
          queue: QUEUES.invoice,
          name: 'generate',
          data: { orderId },
          jobId: jobId('invoice', orderId),
        },
        {
          queue: QUEUES.paymentReminder,
          name: 'remind',
          data: { orderId },
          jobId: jobId('payment-reminder', orderId),
          delayMs: paymentReminderDelayMs,
        },
      ];
    }
    case 'InventoryChanged': {
      const productIds = (event.payload.productIds as string[]) ?? [];
      return productIds.map((productId) => ({
        queue: QUEUES.inventorySync,
        name: 'push-stock',
        data: { productId },
        jobId: jobId('inventory-sync', productId, event.id),
      }));
    }
    default:
      return [];
  }
}
