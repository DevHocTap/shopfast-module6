import { Job } from 'bullmq';
import { DeadLetterService } from '../../infra/queue/dead-letter.service';
import { AiClassifyProcessor } from './ai-classify.processor';
import { TicketClassifierService } from './ticket-classifier.service';

function setup() {
  const classifier = { classify: jest.fn().mockResolvedValue('classified') };
  const deadLetters = { onFailed: jest.fn().mockResolvedValue(true) };
  const processor = new AiClassifyProcessor(
    classifier as unknown as TicketClassifierService,
    deadLetters as unknown as DeadLetterService,
  );
  return { processor, classifier, deadLetters };
}

const job = (attemptsMade: number) =>
  ({ data: { ticketId: 't1' }, attemptsMade, opts: { attempts: 3 } }) as unknown as Job<{
    ticketId: string;
  }>;

describe('AiClassifyProcessor', () => {
  it('lets early attempts fail so BullMQ retries them', async () => {
    const { processor, classifier } = setup();
    await processor.process(job(0));
    expect(classifier.classify).toHaveBeenCalledWith('t1', false);
  });

  it('marks the last attempt so an outage ends as UNCLASSIFIED instead of a dead job', async () => {
    const { processor, classifier } = setup();
    await processor.process(job(2));
    expect(classifier.classify).toHaveBeenCalledWith('t1', true);
  });

  it('hands failures to the dead-letter handler', async () => {
    const { processor, deadLetters } = setup();
    const error = new Error('boom');
    await processor.onFailed(job(3), error);
    expect(deadLetters.onFailed).toHaveBeenCalledWith('ai', expect.anything(), error);
  });
});
