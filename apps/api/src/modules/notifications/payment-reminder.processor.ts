import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Env } from '../../infra/config/env.schema';
import { DeadLetterService } from '../../infra/queue/dead-letter.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { EmailSender, SendOutcome } from './email-sender';
import { paymentReminderEmail } from './email-templates';
import { NotificationsRepository } from './notifications.repository';

/**
 * Delayed job enqueued when the order is placed (PAYMENT_REMINDER_DELAY_MINUTES, default 30).
 * It re-reads the order when it fires: paid or cancelled orders get no reminder.
 */
@Processor(QUEUES.paymentReminder)
export class PaymentReminderProcessor extends WorkerHost {
  private readonly appUrl: string;

  constructor(
    private readonly sender: EmailSender,
    private readonly repo: NotificationsRepository,
    private readonly deadLetters: DeadLetterService,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true });
  }

  async process(job: Job<{ orderId: string }>): Promise<SendOutcome | 'not-needed'> {
    const order = await this.repo.order(job.data.orderId);
    if (!order || order.status !== 'PENDING_PAYMENT') return 'not-needed';
    return this.sender.sendOnce(
      'payment-reminder',
      order.id,
      paymentReminderEmail(order, `${this.appUrl}/orders/${order.id}`),
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): Promise<boolean> {
    return this.deadLetters.onFailed(QUEUES.paymentReminder, job, error);
  }
}
