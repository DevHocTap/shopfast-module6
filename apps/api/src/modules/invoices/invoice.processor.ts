import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DeadLetterService } from '../../infra/queue/dead-letter.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { invoiceNumber, renderInvoice } from './invoice-renderer';
import { InvoicesRepository } from './invoices.repository';

@Processor(QUEUES.invoice)
export class InvoiceProcessor extends WorkerHost {
  constructor(
    private readonly orders: NotificationsRepository,
    private readonly invoices: InvoicesRepository,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<{ orderId: string }>): Promise<'created' | 'exists' | 'skipped'> {
    const { orderId } = job.data;
    if (await this.invoices.exists(orderId)) return 'exists';
    const order = await this.orders.order(orderId);
    if (!order) return 'skipped';
    const issuedAt = new Date();
    const number = invoiceNumber(order.code, issuedAt);
    const created = await this.invoices.insert(
      orderId,
      number,
      renderInvoice(order, number, issuedAt),
    );
    return created ? 'created' : 'exists';
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): Promise<boolean> {
    return this.deadLetters.onFailed(QUEUES.invoice, job, error);
  }
}
