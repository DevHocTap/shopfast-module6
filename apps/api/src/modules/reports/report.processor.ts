import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DeadLetterService } from '../../infra/queue/dead-letter.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { EmailSender } from '../notifications/email-sender';
import { dailyReportEmail } from '../notifications/email-templates';
import { NotificationsRepository } from '../notifications/notifications.repository';
import {
  DailyRevenue,
  previousBusinessDay,
  REPORT_TIME_ZONE,
  ReportsRepository,
} from './reports.repository';

export const DAILY_REVENUE_SCHEDULE = '5 0 * * *';

/**
 * Nightly revenue report (F05): a BullMQ job scheduler fires at 00:05 Vietnam time.
 * The scheduler is upserted at every worker start — idempotent, so restarts/deploys never stack
 * duplicate schedules. The report row is an upsert and each admin email is sent once per day.
 */
@Processor(QUEUES.report)
export class ReportProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReportProcessor.name);

  constructor(
    @InjectQueue(QUEUES.report) private readonly queue: Queue,
    private readonly reports: ReportsRepository,
    private readonly recipients: NotificationsRepository,
    private readonly sender: EmailSender,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'daily-revenue',
        { pattern: DAILY_REVENUE_SCHEDULE, tz: REPORT_TIME_ZONE },
        { name: 'daily-revenue', data: {} },
      );
    } catch (error) {
      this.logger.warn(
        `Could not register the nightly report schedule: ${(error as Error).message}`,
      );
    }
  }

  async process(job: Job<{ date?: string }>): Promise<DailyRevenue> {
    const date = job.data.date ?? previousBusinessDay();
    const report = await this.reports.computeAndStore(date);
    for (const admin of await this.recipients.adminEmails()) {
      await this.sender.sendOnce(
        'daily-report',
        `${date}:${admin}`,
        dailyReportEmail(admin, report),
      );
    }
    return report;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): Promise<boolean> {
    return this.deadLetters.onFailed(QUEUES.report, job, error);
  }
}
