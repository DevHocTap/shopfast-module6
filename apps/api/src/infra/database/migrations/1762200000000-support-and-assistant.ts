import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5 (F01): customer support tickets and the AI assistant's audit trail.
 * Expand-only (new tables and types), so the previous release keeps running during blue/green.
 *   tickets / ticket_messages   conversation between a customer and support staff
 *   assistant_messages          every assistant turn (staff question, answer, tool calls)
 *   agent_actions               write actions the AI may only PROPOSE; staff approve or reject
 *   audit_logs                  who approved what, and what it changed
 */
export class SupportAndAssistant1762200000000 implements MigrationInterface {
  name = 'SupportAndAssistant1762200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TYPE ticket_category AS ENUM ('ORDER_STATUS', 'SHIPPING', 'PAYMENT', 'RETURN_REFUND',
        'PRODUCT_INFO', 'ACCOUNT', 'OTHER', 'UNCLASSIFIED')`);
    await q.query(`CREATE TYPE ticket_status AS ENUM ('OPEN', 'ANSWERED', 'CLOSED')`);
    await q.query(`
      CREATE TABLE tickets (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code                text NOT NULL UNIQUE,
        customer_id         uuid NOT NULL REFERENCES users(id),
        order_id            uuid REFERENCES orders(id),
        subject             text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
        category            ticket_category,
        category_confidence real,
        classified_at       timestamptz,
        status              ticket_status NOT NULL DEFAULT 'OPEN',
        assignee_id         uuid REFERENCES users(id),
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query('CREATE INDEX tickets_queue_idx ON tickets (category, status, created_at DESC)');
    await q.query('CREATE INDEX tickets_customer_idx ON tickets (customer_id, created_at DESC)');

    await q.query(`
      CREATE TABLE ticket_messages (
        id          bigserial PRIMARY KEY,
        ticket_id   uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        author_id   uuid NOT NULL REFERENCES users(id),
        from_staff  boolean NOT NULL,
        body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query('CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, id)');

    await q.query(`
      CREATE TABLE assistant_messages (
        id          bigserial PRIMARY KEY,
        ticket_id   uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        staff_id    uuid NOT NULL REFERENCES users(id),
        role        text NOT NULL CHECK (role IN ('user', 'assistant')),
        content     text NOT NULL,
        tool_calls  jsonb NOT NULL DEFAULT '[]',
        guarded     boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      'CREATE INDEX assistant_messages_thread_idx ON assistant_messages (ticket_id, staff_id, id)',
    );

    await q.query(`
      CREATE TYPE agent_action_status AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED',
        'FAILED')`);
    await q.query(`
      CREATE TABLE agent_actions (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id    uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        type         text NOT NULL CHECK (type IN ('CANCEL_ORDER')),
        order_id     uuid NOT NULL REFERENCES orders(id),
        payload      jsonb NOT NULL DEFAULT '{}',
        status       agent_action_status NOT NULL DEFAULT 'PROPOSED',
        proposed_for uuid NOT NULL REFERENCES users(id),
        reviewed_by  uuid REFERENCES users(id),
        reviewed_at  timestamptz,
        result       text,
        created_at   timestamptz NOT NULL DEFAULT now()
      )`);
    // The assistant cannot pile up the same proposal: one open proposal per (type, order).
    await q.query(
      `CREATE UNIQUE INDEX agent_actions_one_open_idx ON agent_actions (type, order_id)
       WHERE status = 'PROPOSED'`,
    );
    await q.query('CREATE INDEX agent_actions_status_idx ON agent_actions (status, created_at)');

    await q.query(`
      CREATE TABLE audit_logs (
        id          bigserial PRIMARY KEY,
        actor_id    uuid REFERENCES users(id),
        action      text NOT NULL,
        entity      text NOT NULL,
        entity_id   text NOT NULL,
        before      jsonb,
        after       jsonb,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query('CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id, id)');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE audit_logs');
    await q.query('DROP TABLE agent_actions');
    await q.query('DROP TYPE agent_action_status');
    await q.query('DROP TABLE assistant_messages');
    await q.query('DROP TABLE ticket_messages');
    await q.query('DROP TABLE tickets');
    await q.query('DROP TYPE ticket_status');
    await q.query('DROP TYPE ticket_category');
  }
}
