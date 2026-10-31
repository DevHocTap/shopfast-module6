import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 (F05): transactional outbox and the tables that make every job idempotent.
 *   outbox_events            written in the same transaction as the business change
 *   email_logs UNIQUE        (type, ref_id): one confirmation email per order, whatever the retries
 *   invoices UNIQUE          order_id: one invoice per order
 *   daily_revenue_reports PK report_date: re-running the nightly job overwrites, never duplicates
 *   partner_sync_logs UNIQUE idempotency_key: what the (simulated) partner already applied
 *   failed_jobs              dead letter: jobs that exhausted their retries, with the reason
 */
export class BackgroundJobs1762050000000 implements MigrationInterface {
  name = 'BackgroundJobs1762050000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE outbox_events (
        id           bigserial PRIMARY KEY,
        event_type   text NOT NULL,
        aggregate_id text NOT NULL,
        payload      jsonb NOT NULL DEFAULT '{}',
        created_at   timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz,
        attempts     integer NOT NULL DEFAULT 0,
        last_error   text
      )`);
    await q.query(
      'CREATE INDEX outbox_events_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL',
    );

    await q.query(`CREATE TYPE email_status AS ENUM ('SENDING', 'SENT')`);
    await q.query(`
      CREATE TABLE email_logs (
        id                  bigserial PRIMARY KEY,
        type                text NOT NULL,
        ref_id              text NOT NULL,
        recipient           text NOT NULL,
        status              email_status NOT NULL,
        provider_message_id text,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT email_logs_once UNIQUE (type, ref_id)
      )`);

    await q.query(`
      CREATE TABLE invoices (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id       uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        invoice_number text NOT NULL UNIQUE,
        html           text NOT NULL,
        created_at     timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE daily_revenue_reports (
        report_date date PRIMARY KEY,
        order_count integer NOT NULL,
        revenue     bigint NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE partner_sync_logs (
        idempotency_key text PRIMARY KEY,
        product_id      uuid NOT NULL,
        quantity        integer NOT NULL,
        applied_at      timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE failed_jobs (
        id            bigserial PRIMARY KEY,
        queue         text NOT NULL,
        job_name      text NOT NULL,
        job_id        text,
        payload       jsonb NOT NULL,
        reason        text NOT NULL,
        stacktrace    text,
        attempts_made integer NOT NULL,
        failed_at     timestamptz NOT NULL DEFAULT now(),
        retried_at    timestamptz
      )`);
    await q.query(
      'CREATE INDEX failed_jobs_open_idx ON failed_jobs (failed_at DESC) WHERE retried_at IS NULL',
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'failed_jobs',
      'partner_sync_logs',
      'daily_revenue_reports',
      'invoices',
      'email_logs',
      'outbox_events',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
    await q.query('DROP TYPE IF EXISTS email_status');
  }
}
