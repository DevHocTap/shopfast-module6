import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MAIL_TRANSPORT, MailMessage, MailTransport } from '../../infra/mail/mail.transport';

export type SendOutcome = 'sent' | 'already-sent';

/** A claim older than this is considered abandoned (worker crashed mid-send) and taken over. */
export const STALE_CLAIM_MS = 2 * 60_000;

/**
 * Exactly-once *intent* for emails on top of at-least-once jobs (F05: one email per order):
 *   1. claim (type, ref_id) with a UNIQUE row in status SENDING
 *   2. send
 *   3. mark SENT — or delete the claim if sending failed, so the retry can claim again
 * A retried or duplicated job finds the SENT row and does nothing.
 * Residual risk: a crash between 2 and 3 resends once after STALE_CLAIM_MS (documented in ADR-04).
 */
@Injectable()
export class EmailSender {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  async sendOnce(type: string, refId: string, message: MailMessage): Promise<SendOutcome> {
    const claimed: unknown[] = await this.dataSource.query(
      `INSERT INTO email_logs (type, ref_id, recipient, status) VALUES ($1, $2, $3, 'SENDING')
       ON CONFLICT ON CONSTRAINT email_logs_once DO NOTHING RETURNING id`,
      [type, refId, message.to],
    );
    if (claimed.length === 0 && !(await this.takeOverStaleClaim(type, refId))) {
      return 'already-sent';
    }

    try {
      const { messageId } = await this.transport.send(message);
      await this.dataSource.query(
        `UPDATE email_logs SET status = 'SENT', provider_message_id = $3, updated_at = now()
          WHERE type = $1 AND ref_id = $2`,
        [type, refId, messageId ?? null],
      );
      return 'sent';
    } catch (error) {
      await this.dataSource.query(
        `DELETE FROM email_logs WHERE type = $1 AND ref_id = $2 AND status = 'SENDING'`,
        [type, refId],
      );
      throw error;
    }
  }

  /**
   * Existing row: SENT → nothing to do. SENDING and recent → another attempt is in flight, so
   * fail this one (it will be retried later). SENDING and stale → take it over.
   */
  private async takeOverStaleClaim(type: string, refId: string): Promise<boolean> {
    const [row]: { status: string; age_ms: number }[] = await this.dataSource.query(
      `SELECT status, EXTRACT(EPOCH FROM (now() - updated_at)) * 1000 AS age_ms
         FROM email_logs WHERE type = $1 AND ref_id = $2`,
      [type, refId],
    );
    if (!row || row.status === 'SENT') return false;
    if (Number(row.age_ms) < STALE_CLAIM_MS) {
      throw new Error(`Email ${type}/${refId} is being sent by another attempt`);
    }
    await this.dataSource.query(
      'UPDATE email_logs SET updated_at = now() WHERE type = $1 AND ref_id = $2',
      [type, refId],
    );
    return true;
  }
}
