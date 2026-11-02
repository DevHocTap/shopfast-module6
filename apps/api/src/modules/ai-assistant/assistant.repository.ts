import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returningRows } from '../../infra/database/transaction-runner';
import {
  AgentActionStatus,
  AgentActionType,
  AgentActionView,
  AssistantTurn,
  ToolCallView,
} from './assistant.types';

interface RawAction {
  id: string;
  type: AgentActionType;
  status: AgentActionStatus;
  payload: { reason?: string };
  ticket_id: string;
  ticket_code: string;
  order_id: string;
  order_code: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reviewed_at: Date | null;
  result: string | null;
  created_at: Date;
}

const SELECT_ACTION = `
  SELECT a.id, a.type, a.status, a.payload, a.reviewed_at, a.result, a.created_at,
         t.id AS ticket_id, t.code AS ticket_code, o.id AS order_id, o.code AS order_code,
         r.id AS reviewer_id, r.full_name AS reviewer_name
  FROM agent_actions a
  JOIN tickets t ON t.id = a.ticket_id
  JOIN orders o ON o.id = a.order_id
  LEFT JOIN users r ON r.id = a.reviewed_by`;

export interface ProductStock {
  sku: string;
  name: string;
  price: number;
  isActive: boolean;
  quantity: number;
}

@Injectable()
export class AssistantRepository {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Earlier turns of this staff member on this ticket, oldest first. */
  async conversation(ticketId: string, staffId: string, limit = 40): Promise<AssistantTurn[]> {
    const rows: {
      role: 'user' | 'assistant';
      content: string;
      tool_calls: ToolCallView[];
      guarded: boolean;
      created_at: Date;
    }[] = await this.db.query(
      `SELECT role, content, tool_calls, guarded, created_at FROM (
         SELECT * FROM assistant_messages WHERE ticket_id = $1 AND staff_id = $2
         ORDER BY id DESC LIMIT $3) recent
       ORDER BY id`,
      [ticketId, staffId, limit],
    );
    return rows.map((row) => ({
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls,
      guarded: row.guarded,
      createdAt: row.created_at,
    }));
  }

  /** Question and answer are stored together: the trail never has half a turn. */
  async saveTurn(turn: {
    ticketId: string;
    staffId: string;
    question: string;
    answer: string;
    toolCalls: ToolCallView[];
    guarded: boolean;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO assistant_messages (ticket_id, staff_id, role, content, tool_calls, guarded)
       VALUES ($1, $2, 'user', $3, '[]', false), ($1, $2, 'assistant', $4, $5, $6)`,
      [
        turn.ticketId,
        turn.staffId,
        turn.question,
        turn.answer,
        JSON.stringify(turn.toolCalls),
        turn.guarded,
      ],
    );
  }

  async productBySku(sku: string): Promise<ProductStock | null> {
    const rows: {
      sku: string;
      name: string;
      price: string;
      is_active: boolean;
      quantity: number | null;
    }[] = await this.db.query(
      `SELECT p.sku, p.name, p.price, p.is_active, i.quantity
       FROM products p LEFT JOIN inventories i ON i.product_id = p.id
       WHERE p.sku = $1`,
      [sku],
    );
    const row = rows[0];
    return row
      ? {
          sku: row.sku,
          name: row.name,
          price: Number(row.price),
          isActive: row.is_active,
          quantity: row.quantity ?? 0,
        }
      : null;
  }

  /**
   * Records a proposal. The partial unique index keeps one open proposal per (type, order):
   * asking twice returns the existing one instead of piling up duplicates.
   */
  async propose(proposal: {
    ticketId: string;
    type: AgentActionType;
    orderId: string;
    reason: string;
    proposedFor: string;
  }): Promise<{ id: string; created: boolean }> {
    const inserted: { id: string }[] = await this.db.query(
      `INSERT INTO agent_actions (ticket_id, type, order_id, payload, proposed_for)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (type, order_id) WHERE status = 'PROPOSED' DO NOTHING
       RETURNING id`,
      [
        proposal.ticketId,
        proposal.type,
        proposal.orderId,
        JSON.stringify({ reason: proposal.reason }),
        proposal.proposedFor,
      ],
    );
    if (inserted[0]) return { id: inserted[0].id, created: true };
    const open: { id: string }[] = await this.db.query(
      `SELECT id FROM agent_actions WHERE type = $1 AND order_id = $2 AND status = 'PROPOSED'`,
      [proposal.type, proposal.orderId],
    );
    return { id: open[0].id, created: false };
  }

  async actions(filter: {
    status?: AgentActionStatus;
    ticketId?: string;
    limit?: number;
  }): Promise<AgentActionView[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`a.status = $${params.length}`);
    }
    if (filter.ticketId) {
      params.push(filter.ticketId);
      where.push(`a.ticket_id = $${params.length}`);
    }
    params.push(filter.limit ?? 50);
    const rows: RawAction[] = await this.db.query(
      `${SELECT_ACTION} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(toView);
  }

  async action(id: string): Promise<AgentActionView | null> {
    const rows: RawAction[] = await this.db.query(`${SELECT_ACTION} WHERE a.id = $1`, [id]);
    return rows[0] ? toView(rows[0]) : null;
  }

  /**
   * PROPOSED → APPROVED/REJECTED, only once: two staff members clicking at the same moment
   * cannot both execute the action.
   */
  async claim(
    id: string,
    to: AgentActionStatus.APPROVED | AgentActionStatus.REJECTED,
    reviewerId: string,
  ): Promise<boolean> {
    const rows = await returningRows<{ id: string }>(
      this.db.manager,
      `UPDATE agent_actions SET status = $2, reviewed_by = $3, reviewed_at = now()
       WHERE id = $1 AND status = 'PROPOSED' RETURNING id`,
      [id, to, reviewerId],
    );
    return rows.length > 0;
  }

  async finish(
    id: string,
    status: AgentActionStatus.EXECUTED | AgentActionStatus.FAILED,
    result: string,
  ): Promise<void> {
    await this.db.query('UPDATE agent_actions SET status = $2, result = $3 WHERE id = $1', [
      id,
      status,
      result,
    ]);
  }

  async audit(entry: {
    actorId: string;
    action: string;
    entity: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, before, after)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.actorId,
        entry.action,
        entry.entity,
        entry.entityId,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
      ],
    );
  }
}

function toView(row: RawAction): AgentActionView {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    reason: row.payload?.reason ?? '',
    ticket: { id: row.ticket_id, code: row.ticket_code },
    order: { id: row.order_id, code: row.order_code },
    reviewedBy: row.reviewer_id ? { id: row.reviewer_id, fullName: row.reviewer_name ?? '' } : null,
    reviewedAt: row.reviewed_at,
    result: row.result,
    createdAt: row.created_at,
  };
}
