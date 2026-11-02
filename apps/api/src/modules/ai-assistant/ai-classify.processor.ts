import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DeadLetterService } from '../../infra/queue/dead-letter.service';
import { JOB_OPTIONS, QUEUES } from '../../infra/queue/queue.constants';
import { ClassifyOutcome, TicketClassifierService } from './ticket-classifier.service';

/**
 * TicketCreated → classify. Idempotent: the category is only written while still empty, so a
 * re-delivered job (or one that runs after a staff member sorted the ticket) changes nothing.
 */
@Processor(QUEUES.ai)
export class AiClassifyProcessor extends WorkerHost {
  constructor(
    private readonly classifier: TicketClassifierService,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  process(job: Job<{ ticketId: string }>): Promise<ClassifyOutcome> {
    const attempts = job.opts.attempts ?? JOB_OPTIONS[QUEUES.ai].attempts ?? 1;
    return this.classifier.classify(job.data.ticketId, job.attemptsMade + 1 >= attempts);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): Promise<boolean> {
    return this.deadLetters.onFailed(QUEUES.ai, job, error);
  }
}
