import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returningRows, Tx } from '../../infra/database/transaction-runner';
import {
  TicketCategory,
  TicketDetail,
  TicketMessage,
  TicketStatus,
  TicketSummary,
} from './support.types';

interface RawTicket {
  id: string;
  code: string;
  subject: string;
  status: TicketStatus;
  category: TicketCategory | null;
  category_confidence: number | null;
  order_id: string | null;
  order_code: string | null;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  created_at: Date;
  updated_at: Date;
}

const SELECT_TICKET = `
  SELECT t.id, t.code, t.subject, t.status, t.category, t.category_confidence,
         t.order_id, o.code AS order_code, t.created_at, t.updated_at,
         u.id AS customer_id, u.email AS customer_email, u.full_name AS customer_name
  FROM tickets t
  JOIN users u ON u.id = t.customer_id
  LEFT JOIN orders o ON o.id = t.order_id`;

export interface TicketFilter {
  customerId?: string;
  category?: TicketCategory;
  status?: TicketStatus;
}

@Injectable()
export class SupportRepository {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async insertTicket(
    tx: Tx,
    ticket: { code: string; customerId: string; orderId: string | null; subject: string },
  ): Promise<string> {
    const rows: { id: string }[] = await tx.query(
      `INSERT INTO tickets (code, customer_id, order_id, subject) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [ticket.code, ticket.customerId, ticket.orderId, ticket.subject],
    );
    return rows[0].id;
  }

  async insertMessage(
    tx: Tx,
    message: { ticketId: string; authorId: string; fromStaff: boolean; body: string },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO ticket_messages (ticket_id, author_id, from_staff, body) VALUES ($1, $2, $3, $4)`,
      [message.ticketId, message.authorId, message.fromStaff, message.body],
    );
  }

  /** Locks the ticket row: concurrent replies and status changes are serialised. */
  async lock(
    tx: Tx,
    ticketId: string,
  ): Promise<{ id: string; customerId: string; status: TicketStatus } | null> {
    const rows: { id: string; customer_id: string; status: TicketStatus }[] = await tx.query(
      'SELECT id, customer_id, status FROM tickets WHERE id = $1 FOR UPDATE',
      [ticketId],
    );
    const row = rows[0];
    return row ? { id: row.id, customerId: row.customer_id, status: row.status } : null;
  }

  async update(
    tx: Tx,
    ticketId: string,
    changes: { status?: TicketStatus; category?: TicketCategory; assigneeId?: string },
  ): Promise<void> {
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [ticketId];
    if (changes.status) {
      params.push(changes.status);
      sets.push(`status = $${params.length}`);
    }
    if (changes.category) {
      params.push(changes.category);
      // A human decision: full confidence, and the classifier will never overwrite it.
      sets.push(`category = $${params.length}, category_confidence = 1, classified_at = now()`);
    }
    if (changes.assigneeId) {
      params.push(changes.assigneeId);
      sets.push(`assignee_id = $${params.length}`);
    }
    await tx.query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  /**
   * Classifier result. Only fills an empty category: re-running the job, or a staff member's
   * manual choice made in the meantime, is never overwritten.
   */
  async saveClassification(
    ticketId: string,
    category: TicketCategory,
    confidence: number,
  ): Promise<boolean> {
    const rows = await returningRows<{ id: string }>(
      this.db.manager,
      `UPDATE tickets SET category = $2, category_confidence = $3, classified_at = now()
       WHERE id = $1 AND category IS NULL RETURNING id`,
      [ticketId, category, confidence],
    );
    return rows.length > 0;
  }

  /** Text the classifier reads: subject + the customer's first message. */
  async classificationInput(
    ticketId: string,
  ): Promise<{ subject: string; body: string; category: TicketCategory | null } | null> {
    const rows: { subject: string; body: string | null; category: TicketCategory | null }[] =
      await this.db.query(
        `SELECT t.subject, t.category,
                (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY id LIMIT 1)
                  AS body
         FROM tickets t WHERE t.id = $1`,
        [ticketId],
      );
    const row = rows[0];
    return row ? { subject: row.subject, body: row.body ?? '', category: row.category } : null;
  }

  async list(
    filter: TicketFilter,
    offset: number,
    limit: number,
  ): Promise<{ rows: TicketSummary[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.customerId) {
      params.push(filter.customerId);
      where.push(`t.customer_id = $${params.length}`);
    }
    if (filter.category) {
      params.push(filter.category);
      where.push(`t.category = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`t.status = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows, count] = (await Promise.all([
      this.db.query(
        `${SELECT_TICKET} ${clause} ORDER BY t.updated_at DESC, t.id
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      this.db.query(`SELECT count(*) AS total FROM tickets t ${clause}`, params),
    ])) as [RawTicket[], { total: string }[]];
    return { rows: rows.map(toSummary), total: Number(count[0].total) };
  }

  async detail(ticketId: string): Promise<TicketDetail | null> {
    const rows: RawTicket[] = await this.db.query(`${SELECT_TICKET} WHERE t.id = $1`, [ticketId]);
    if (!rows[0]) return null;
    const messages: {
      id: string;
      from_staff: boolean;
      author_id: string;
      author_name: string;
      body: string;
      created_at: Date;
    }[] = await this.db.query(
      `SELECT m.id, m.from_staff, m.author_id, u.full_name AS author_name, m.body, m.created_at
       FROM ticket_messages m JOIN users u ON u.id = m.author_id
       WHERE m.ticket_id = $1 ORDER BY m.id`,
      [ticketId],
    );
    return {
      ...toSummary(rows[0]),
      messages: messages.map((m): TicketMessage => ({
        id: String(m.id),
        fromStaff: m.from_staff,
        author: { id: m.author_id, fullName: m.author_name },
        body: m.body,
        createdAt: m.created_at,
      })),
    };
  }

  async orderOwner(orderId: string): Promise<string | null> {
    const rows: { user_id: string }[] = await this.db.query(
      'SELECT user_id FROM orders WHERE id = $1',
      [orderId],
    );
    return rows[0]?.user_id ?? null;
  }
}

function toSummary(row: RawTicket): TicketSummary {
  return {
    id: row.id,
    code: row.code,
    subject: row.subject,
    status: row.status,
    category: row.category,
    categoryConfidence: row.category_confidence === null ? null : Number(row.category_confidence),
    order: row.order_id && row.order_code ? { id: row.order_id, code: row.order_code } : null,
    customer: { id: row.customer_id, email: row.customer_email, fullName: row.customer_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
