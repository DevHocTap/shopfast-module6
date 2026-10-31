import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesRepository } from './invoices.repository';

/** API side (download). The worker side (InvoiceProcessor) is wired in worker/jobs.module.ts. */
@Module({
  imports: [OrdersModule],
  controllers: [InvoicesController],
  providers: [InvoicesRepository],
})
export class InvoicesModule {}
