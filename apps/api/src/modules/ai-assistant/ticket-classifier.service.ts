import { Injectable, Logger } from '@nestjs/common';
import { LlmPort, LlmUnavailableError } from '../../infra/llm/llm.port';
import { SupportRepository } from '../support/support.repository';
import { CLASSIFIABLE, TicketCategory } from '../support/support.types';
import {
  CLASSIFIER_SYSTEM_PROMPT,
  classifierInput,
  MIN_CLASSIFIER_CONFIDENCE,
} from './assistant.prompts';

export type ClassifyOutcome = 'classified' | 'already-classified' | 'missing';

/** Sorts a new ticket into a support queue (F01.1). Runs in the worker (job `ai-classify`). */
@Injectable()
export class TicketClassifierService {
  private readonly logger = new Logger(TicketClassifierService.name);

  constructor(
    private readonly llm: LlmPort,
    private readonly tickets: SupportRepository,
  ) {}

  /**
   * `finalAttempt`: on the last try a provider outage files the ticket as UNCLASSIFIED instead of
   * failing, so a human still sees it in the queue.
   */
  async classify(ticketId: string, finalAttempt = true): Promise<ClassifyOutcome> {
    const ticket = await this.tickets.classificationInput(ticketId);
    if (!ticket) return 'missing';
    if (ticket.category) return 'already-classified';

    let category = TicketCategory.UNCLASSIFIED;
    let confidence = 0;
    try {
      const result = await this.llm.classify({
        system: CLASSIFIER_SYSTEM_PROMPT,
        input: classifierInput(ticket.subject, ticket.body),
        labels: CLASSIFIABLE,
      });
      confidence = result.confidence;
      if (
        CLASSIFIABLE.includes(result.label as TicketCategory) &&
        result.confidence >= MIN_CLASSIFIER_CONFIDENCE
      ) {
        category = result.label as TicketCategory;
      }
    } catch (error) {
      const unavailable = error instanceof LlmUnavailableError && !this.llm.available;
      if (!unavailable && !finalAttempt) throw error; // let BullMQ retry with backoff
      this.logger.warn(`Ticket ${ticketId} left UNCLASSIFIED: ${(error as Error).message}`);
    }

    await this.tickets.saveClassification(ticketId, category, confidence);
    return 'classified';
  }
}
