import { QUEUES } from '../queue/queue.constants';
import { jobsFor } from './outbox-dispatch';

describe('jobsFor (outbox fan-out)', () => {
  it('turns OrderPlaced into confirmation email, invoice and a delayed payment reminder', () => {
    const jobs = jobsFor(
      { id: '7', type: 'OrderPlaced', aggregateId: 'o1', payload: { orderId: 'o1' } },
      30 * 60_000,
    );

    expect(jobs).toEqual([
      expect.objectContaining({
        queue: QUEUES.email,
        name: 'order-confirmation',
        jobId: 'order-confirmation-o1',
      }),
      expect.objectContaining({ queue: QUEUES.invoice, jobId: 'invoice-o1' }),
      expect.objectContaining({
        queue: QUEUES.paymentReminder,
        jobId: 'payment-reminder-o1',
        delayMs: 1_800_000,
      }),
    ]);
  });

  it('pushes stock to the partner for every changed product, keyed by event', () => {
    const jobs = jobsFor(
      {
        id: '9',
        type: 'InventoryChanged',
        aggregateId: 'o1',
        payload: { productIds: ['a', 'b'], reason: 'ORDER' },
      },
      0,
    );

    expect(jobs.map((job) => job.jobId)).toEqual(['inventory-sync-a-9', 'inventory-sync-b-9']);
  });

  it('gives the same job ids when the same event is published twice (idempotent enqueue)', () => {
    const event = { id: '1', type: 'OrderPlaced', aggregateId: 'o', payload: { orderId: 'o' } };
    expect(jobsFor(event, 0)).toEqual(jobsFor(event, 0));
  });

  it('ignores unknown events', () => {
    expect(jobsFor({ id: '1', type: 'Nope', aggregateId: 'x', payload: {} }, 0)).toEqual([]);
  });
});
