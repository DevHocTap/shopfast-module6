import { DataSource } from 'typeorm';
import { LogMailTransport, MailMessage } from '../../infra/mail/mail.transport';
import { EmailSender, STALE_CLAIM_MS } from './email-sender';

/** email_logs in memory, answering the four statements EmailSender issues. */
function fakeEmailLogs() {
  const rows = new Map<string, { status: string; updatedAt: number }>();
  let now = 0;
  const key = (params: unknown[]) => `${String(params[0])}/${String(params[1])}`;
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('INSERT INTO email_logs')) {
        if (rows.has(key(params))) return [];
        rows.set(key(params), { status: 'SENDING', updatedAt: now });
        return [{ id: 1 }];
      }
      if (sql.includes("SET status = 'SENT'")) {
        rows.get(key(params))!.status = 'SENT';
        return [];
      }
      if (sql.startsWith('DELETE FROM email_logs')) {
        if (rows.get(key(params))?.status === 'SENDING') rows.delete(key(params));
        return [];
      }
      if (sql.startsWith('SELECT status')) {
        const row = rows.get(key(params));
        return row ? [{ status: row.status, age_ms: now - row.updatedAt }] : [];
      }
      if (sql.startsWith('UPDATE email_logs SET updated_at')) {
        rows.get(key(params))!.updatedAt = now;
        return [];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  return {
    dataSource: dataSource as unknown as DataSource,
    rows,
    tick: (ms: number) => (now += ms),
  };
}

const message: MailMessage = { to: 'an@example.com', subject: 's', html: '<p>h</p>', text: 't' };

function setup() {
  const logs = fakeEmailLogs();
  const transport = new LogMailTransport();
  return { sender: new EmailSender(logs.dataSource, transport), transport, logs };
}

describe('EmailSender', () => {
  it('sends a given email only once, however many times the job runs', async () => {
    const { sender, transport } = setup();

    const outcomes = [
      await sender.sendOnce('order-confirmation', 'o1', message),
      await sender.sendOnce('order-confirmation', 'o1', message),
      await sender.sendOnce('order-confirmation', 'o1', message),
    ];

    expect(outcomes).toEqual(['sent', 'already-sent', 'already-sent']);
    expect(transport.sent).toHaveLength(1);
  });

  it('releases the claim when sending fails, so the retry can send', async () => {
    const { sender, transport, logs } = setup();
    jest.spyOn(transport, 'send').mockRejectedValueOnce(new Error('SMTP down'));

    await expect(sender.sendOnce('order-confirmation', 'o2', message)).rejects.toThrow('SMTP down');
    expect(logs.rows.has('order-confirmation/o2')).toBe(false);

    await expect(sender.sendOnce('order-confirmation', 'o2', message)).resolves.toBe('sent');
  });

  it('does not send in parallel with an attempt still in flight, but takes over a stale one', async () => {
    const { sender, logs, transport } = setup();
    logs.rows.set('otp/x', { status: 'SENDING', updatedAt: 0 });

    await expect(sender.sendOnce('otp', 'x', message)).rejects.toThrow(/another attempt/);

    logs.tick(STALE_CLAIM_MS + 1);
    await expect(sender.sendOnce('otp', 'x', message)).resolves.toBe('sent');
    expect(transport.sent).toHaveLength(1);
  });

  it('treats different references as different emails', async () => {
    const { sender, transport } = setup();

    await sender.sendOnce('order-confirmation', 'a', message);
    await sender.sendOnce('order-confirmation', 'b', message);
    await sender.sendOnce('payment-reminder', 'a', message);

    expect(transport.sent).toHaveLength(3);
  });
});
