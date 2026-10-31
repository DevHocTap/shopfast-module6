import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Env } from '../../infra/config/env.schema';
import { DeadLetterService } from '../../infra/queue/dead-letter.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { EmailSender, SendOutcome } from './email-sender';
import { orderConfirmationEmail, otpEmail } from './email-templates';
import { NotificationsRepository } from './notifications.repository';

export interface OtpJobData {
  email: string;
  code: string;
  issuedAt: number;
}

@Processor(QUEUES.email)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
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

  async process(job: Job): Promise<SendOutcome | 'skipped'> {
    switch (job.name) {
      case 'order-confirmation': {
        const { orderId } = job.data as { orderId: string };
        const order = await this.repo.order(orderId);
        if (!order) return 'skipped';
        return this.sender.sendOnce(
          'order-confirmation',
          orderId,
          orderConfirmationEmail(order, `${this.appUrl}/orders/${orderId}`),
        );
      }
      case 'otp': {
        const { email, code, issuedAt } = job.data as OtpJobData;
        return this.sender.sendOnce('otp', `${email}:${issuedAt}`, otpEmail(email, code));
      }
      default:
        this.logger.warn(`Unknown email job "${job.name}"`);
        return 'skipped';
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): Promise<boolean> {
    return this.deadLetters.onFailed(QUEUES.email, job, error);
  }
}
