import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { DeadLetterService } from '../../infra/queue/dead-letter.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { PARTNER_CLIENT, PartnerClient } from './partner-client';

/**
 * Pushes the CURRENT stock of a product to the partner. The key includes the inventory version,
 * so a retry of the same change is ignored by the partner, while a newer change is a new key.
 */
@Processor(QUEUES.inventorySync)
export class InventorySyncProcessor extends WorkerHost {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(PARTNER_CLIENT) private readonly partner: PartnerClient,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<{ productId: string }>): Promise<'applied' | 'duplicate' | 'skipped'> {
    const [stock]: { quantity: number; version: number }[] = await this.dataSource.query(
      'SELECT quantity, version FROM inventories WHERE product_id = $1',
      [job.data.productId],
    );
    if (!stock) return 'skipped';
    const { applied } = await this.partner.pushStock({
      productId: job.data.productId,
      quantity: stock.quantity,
      idempotencyKey: `stock-${job.data.productId}-v${stock.version}`,
    });
    return applied ? 'applied' : 'duplicate';
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): Promise<boolean> {
    return this.deadLetters.onFailed(QUEUES.inventorySync, job, error);
  }
}
