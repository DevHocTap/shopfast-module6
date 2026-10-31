import { Global, Module } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';

/** Writing side, used by api modules inside their transactions. The relay lives in the worker. */
@Global()
@Module({
  providers: [OutboxRepository],
  exports: [OutboxRepository],
})
export class OutboxModule {}
