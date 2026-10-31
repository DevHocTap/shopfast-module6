import { Module } from '@nestjs/common';
import { OutboxRelay } from '../infra/outbox/outbox.relay';
import { DeadLetterService } from '../infra/queue/dead-letter.service';
import { InvoiceProcessor } from '../modules/invoices/invoice.processor';
import { InvoicesRepository } from '../modules/invoices/invoices.repository';
import { EmailSender } from '../modules/notifications/email-sender';
import { EmailProcessor } from '../modules/notifications/email.processor';
import { NotificationsRepository } from '../modules/notifications/notifications.repository';
import { PaymentReminderProcessor } from '../modules/notifications/payment-reminder.processor';
import { InventorySyncProcessor } from '../modules/partner-sync/inventory-sync.processor';
import { PARTNER_CLIENT, SimulatedPartnerClient } from '../modules/partner-sync/partner-client';
import { ReportProcessor } from '../modules/reports/report.processor';
import { ReportsRepository } from '../modules/reports/reports.repository';

/** Everything the worker process runs: the outbox relay and one processor per queue. */
@Module({
  providers: [
    OutboxRelay,
    DeadLetterService,
    EmailSender,
    NotificationsRepository,
    InvoicesRepository,
    ReportsRepository,
    { provide: PARTNER_CLIENT, useClass: SimulatedPartnerClient },
    EmailProcessor,
    PaymentReminderProcessor,
    InvoiceProcessor,
    InventorySyncProcessor,
    ReportProcessor,
  ],
})
export class JobsModule {}
