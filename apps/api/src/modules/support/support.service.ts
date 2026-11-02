import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { isStaff } from '../../common/auth/role.enum';
import { Paginated, paginated } from '../../common/dto/pagination.dto';
import { TransactionRunner } from '../../infra/database/transaction-runner';
import { OutboxRepository } from '../../infra/outbox/outbox.repository';
import { SupportErrors } from './support.errors';
import { SupportRepository, TicketFilter } from './support.repository';
import { TicketCategory, TicketDetail, TicketStatus, TicketSummary } from './support.types';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class SupportService {
  constructor(
    private readonly tickets: SupportRepository,
    private readonly tx: TransactionRunner,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Ticket + first message + TicketCreated in one transaction: the AI classification job can
   * never be lost, and the customer gets an answer immediately (classification is async).
   */
  async create(
    customer: AuthUser,
    input: { subject: string; message: string; orderId?: string },
  ): Promise<TicketDetail> {
    if (input.orderId && (await this.tickets.orderOwner(input.orderId)) !== customer.id) {
      throw SupportErrors.orderNotFound();
    }
    const id = await this.tx.run(async (tx) => {
      const ticketId = await this.tickets.insertTicket(tx, {
        code: generateTicketCode(),
        customerId: customer.id,
        orderId: input.orderId ?? null,
        subject: input.subject,
      });
      await this.tickets.insertMessage(tx, {
        ticketId,
        authorId: customer.id,
        fromStaff: false,
        body: input.message,
      });
      await this.outbox.add(tx, [
        { type: 'TicketCreated', aggregateId: ticketId, payload: { ticketId } },
      ]);
      return ticketId;
    });
    return this.detailOrThrow(id);
  }

  listMine(customer: AuthUser, page: number, limit: number): Promise<Paginated<TicketSummary>> {
    return this.list({ customerId: customer.id }, page, limit);
  }

  listForStaff(
    filter: Omit<TicketFilter, 'customerId'>,
    page: number,
    limit: number,
  ): Promise<Paginated<TicketSummary>> {
    return this.list(filter, page, limit);
  }

  async get(user: AuthUser, ticketId: string): Promise<TicketDetail> {
    const ticket = await this.detailOrThrow(ticketId);
    // Another customer's ticket answers 404: existence is not revealed.
    if (!isStaff(user.role) && ticket.customer.id !== user.id) throw SupportErrors.notFound();
    return ticket;
  }

  /** A customer follow-up re-opens the ticket; a staff reply marks it ANSWERED. */
  async reply(user: AuthUser, ticketId: string, body: string): Promise<TicketDetail> {
    const staff = isStaff(user.role);
    await this.tx.run(async (tx) => {
      const ticket = await this.tickets.lock(tx, ticketId);
      if (!ticket || (!staff && ticket.customerId !== user.id)) throw SupportErrors.notFound();
      if (ticket.status === TicketStatus.CLOSED) throw SupportErrors.closed();
      await this.tickets.insertMessage(tx, { ticketId, authorId: user.id, fromStaff: staff, body });
      await this.tickets.update(tx, ticketId, {
        status: staff ? TicketStatus.ANSWERED : TicketStatus.OPEN,
        assigneeId: staff ? user.id : undefined,
      });
    });
    return this.detailOrThrow(ticketId);
  }

  async updateByStaff(
    staff: AuthUser,
    ticketId: string,
    changes: { status?: TicketStatus; category?: TicketCategory },
  ): Promise<TicketDetail> {
    await this.tx.run(async (tx) => {
      if (!(await this.tickets.lock(tx, ticketId))) throw SupportErrors.notFound();
      await this.tickets.update(tx, ticketId, { ...changes, assigneeId: staff.id });
    });
    return this.detailOrThrow(ticketId);
  }

  private async list(
    filter: TicketFilter,
    page: number,
    limit: number,
  ): Promise<Paginated<TicketSummary>> {
    const { rows, total } = await this.tickets.list(filter, (page - 1) * limit, limit);
    return paginated(rows, total, page, limit);
  }

  private async detailOrThrow(ticketId: string): Promise<TicketDetail> {
    const ticket = await this.tickets.detail(ticketId);
    if (!ticket) throw SupportErrors.notFound();
    return ticket;
  }
}

/** e.g. TK-7KQ2M9 */
export function generateTicketCode(): string {
  let code = 'TK-';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}
