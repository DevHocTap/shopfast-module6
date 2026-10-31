import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Env } from '../infra/config/env.schema';
import { DeadLetterService } from '../infra/queue/dead-letter.service';
import { InvoiceProcessor } from '../modules/invoices/invoice.processor';
import { invoiceNumber, renderInvoice } from '../modules/invoices/invoice-renderer';
import { InvoicesRepository } from '../modules/invoices/invoices.repository';
import { EmailSender } from '../modules/notifications/email-sender';
import { EmailProcessor } from '../modules/notifications/email.processor';
import {
  NotificationsRepository,
  OrderForEmail,
} from '../modules/notifications/notifications.repository';
import { PaymentReminderProcessor } from '../modules/notifications/payment-reminder.processor';
import { InventorySyncProcessor } from '../modules/partner-sync/inventory-sync.processor';
import { PartnerClient, SimulatedPartnerClient } from '../modules/partner-sync/partner-client';
import { ReportProcessor } from '../modules/reports/report.processor';
import { previousBusinessDay, ReportsRepository } from '../modules/reports/reports.repository';

const order: OrderForEmail = {
  id: 'o1',
  code: 'SF-ABC12345',
  status: 'PENDING_PAYMENT',
  total: 900_000,
  discount: 100_000,
  customerEmail: 'an@example.com',
  customerName: 'An <script>',
  items: [{ name: 'Loa & Tai nghe', quantity: 2, lineTotal: 1_000_000 }],
};

const job = <T>(name: string, data: T, extra: Partial<Job> = {}) =>
  ({ name, data, opts: { attempts: 3 }, attemptsMade: 0, ...extra }) as unknown as Job<T>;

const config = {
  get: (key: string) => (key === 'APP_PUBLIC_URL' ? 'https://shop.test' : 0.5),
} as unknown as ConfigService<Env, true>;

function shared() {
  const sender = { sendOnce: jest.fn().mockResolvedValue('sent') };
  const repo = {
    order: jest.fn().mockResolvedValue(order),
    adminEmails: jest.fn().mockResolvedValue(['admin@shop.test', 'boss@shop.test']),
  };
  const deadLetters = { onFailed: jest.fn().mockResolvedValue(true) };
  return {
    sender,
    repo,
    deadLetters,
    asSender: sender as unknown as EmailSender,
    asRepo: repo as unknown as NotificationsRepository,
    asDead: deadLetters as unknown as DeadLetterService,
  };
}

describe('EmailProcessor', () => {
  it('sends the order confirmation with a link to the order', async () => {
    const s = shared();
    const processor = new EmailProcessor(s.asSender, s.asRepo, s.asDead, config);

    await processor.process(job('order-confirmation', { orderId: 'o1' }));

    expect(s.sender.sendOnce).toHaveBeenCalledWith(
      'order-confirmation',
      'o1',
      expect.objectContaining({
        to: 'an@example.com',
        subject: 'Xác nhận đơn hàng SF-ABC12345',
        text: expect.stringContaining('https://shop.test/orders/o1'),
      }),
    );
  });

  it('sends OTP codes once per issued code and skips unknown jobs or orders', async () => {
    const s = shared();
    const processor = new EmailProcessor(s.asSender, s.asRepo, s.asDead, config);

    await processor.process(job('otp', { email: 'x@y.vn', code: '123456', issuedAt: 42 }));
    expect(s.sender.sendOnce).toHaveBeenCalledWith(
      'otp',
      'x@y.vn:42',
      expect.objectContaining({ subject: expect.stringContaining('123456') }),
    );

    s.repo.order.mockResolvedValueOnce(null);
    await expect(processor.process(job('order-confirmation', { orderId: 'gone' }))).resolves.toBe(
      'skipped',
    );
    await expect(processor.process(job('mystery', {}))).resolves.toBe('skipped');
  });

  it('forwards failures to the dead letter', async () => {
    const s = shared();
    const processor = new EmailProcessor(s.asSender, s.asRepo, s.asDead, config);
    const failed = job('otp', {});

    await processor.onFailed(failed, new Error('boom'));

    expect(s.deadLetters.onFailed).toHaveBeenCalledWith('email', failed, expect.any(Error));
  });
});

describe('PaymentReminderProcessor', () => {
  it('reminds only orders that are still unpaid when the delay expires', async () => {
    const s = shared();
    const processor = new PaymentReminderProcessor(s.asSender, s.asRepo, s.asDead, config);

    await expect(processor.process(job('remind', { orderId: 'o1' }))).resolves.toBe('sent');
    expect(s.sender.sendOnce).toHaveBeenCalledWith('payment-reminder', 'o1', expect.anything());

    s.repo.order.mockResolvedValueOnce({ ...order, status: 'PAID' });
    await expect(processor.process(job('remind', { orderId: 'o1' }))).resolves.toBe('not-needed');
    expect(s.sender.sendOnce).toHaveBeenCalledTimes(1);
  });
});

describe('InvoiceProcessor', () => {
  it('creates one invoice per order and is a no-op when it already exists', async () => {
    const s = shared();
    const invoices = {
      exists: jest.fn().mockResolvedValue(false),
      insert: jest.fn().mockResolvedValue(true),
    };
    const processor = new InvoiceProcessor(
      s.asRepo,
      invoices as unknown as InvoicesRepository,
      s.asDead,
    );

    await expect(processor.process(job('generate', { orderId: 'o1' }))).resolves.toBe('created');
    expect(invoices.insert).toHaveBeenCalledWith(
      'o1',
      expect.stringMatching(/^INV-\d{8}-SFABC12345$/),
      expect.any(String),
    );

    invoices.exists.mockResolvedValue(true);
    await expect(processor.process(job('generate', { orderId: 'o1' }))).resolves.toBe('exists');
    expect(invoices.insert).toHaveBeenCalledTimes(1);
  });

  it('renders escaped, printable HTML with the totals', () => {
    const html = renderInvoice(
      order,
      invoiceNumber(order.code, new Date('2026-10-31T10:00:00Z')),
      new Date(),
    );

    expect(html).toContain('INV-20261031-SFABC12345');
    expect(html).toContain('An &#60;script&#62;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Loa &#38; Tai nghe');
    expect(html).toMatch(/Giảm giá/);
  });
});

describe('InventorySyncProcessor', () => {
  const stockQuery = (rows: unknown[]) =>
    ({ query: jest.fn().mockResolvedValue(rows) }) as unknown as DataSource;

  it('pushes the current stock with a version-based idempotency key', async () => {
    const partner: PartnerClient = { pushStock: jest.fn().mockResolvedValue({ applied: true }) };
    const processor = new InventorySyncProcessor(
      stockQuery([{ quantity: 7, version: 12 }]),
      partner,
      shared().asDead,
    );

    await expect(processor.process(job('push-stock', { productId: 'p1' }))).resolves.toBe(
      'applied',
    );
    expect(partner.pushStock).toHaveBeenCalledWith({
      productId: 'p1',
      quantity: 7,
      idempotencyKey: 'stock-p1-v12',
    });
  });

  it('reports a duplicate the partner already applied, and skips unknown products', async () => {
    const partner: PartnerClient = { pushStock: jest.fn().mockResolvedValue({ applied: false }) };
    await expect(
      new InventorySyncProcessor(
        stockQuery([{ quantity: 1, version: 1 }]),
        partner,
        shared().asDead,
      ).process(job('push-stock', { productId: 'p1' })),
    ).resolves.toBe('duplicate');
    await expect(
      new InventorySyncProcessor(stockQuery([]), partner, shared().asDead).process(
        job('push-stock', { productId: 'x' }),
      ),
    ).resolves.toBe('skipped');
  });
});

describe('SimulatedPartnerClient', () => {
  it('fails at the configured rate and otherwise records the key once', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ k: 1 }])
        .mockResolvedValueOnce([]),
    };
    const client = new SimulatedPartnerClient(dataSource as unknown as DataSource, config);
    const update = { productId: 'p', quantity: 1, idempotencyKey: 'k' };

    client.random = () => 0.1; // below the 0.5 failure rate of this config
    await expect(client.pushStock(update)).rejects.toThrow(/giả lập/);

    client.random = () => 0.9;
    await expect(client.pushStock(update)).resolves.toEqual({ applied: true });
    await expect(client.pushStock(update)).resolves.toEqual({ applied: false });
  });
});

describe('ReportProcessor', () => {
  function reportSetup() {
    const s = shared();
    const queue = { upsertJobScheduler: jest.fn().mockResolvedValue({}) };
    const reports = {
      computeAndStore: jest.fn(async (date: string) => ({ date, orderCount: 3, revenue: 9 })),
    };
    const processor = new ReportProcessor(
      queue as unknown as Queue,
      reports as unknown as ReportsRepository,
      s.asRepo,
      s.asSender,
      s.asDead,
    );
    return { ...s, queue, reports, processor };
  }

  it('registers the 00:05 Vietnam-time schedule idempotently at startup', async () => {
    const { processor, queue } = reportSetup();

    await processor.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'daily-revenue',
      { pattern: '5 0 * * *', tz: 'Asia/Ho_Chi_Minh' },
      { name: 'daily-revenue', data: {} },
    );
  });

  it('stores the report and emails each admin once per day', async () => {
    const { processor, reports, sender } = reportSetup();

    await processor.process(job('daily-revenue', { date: '2026-10-30' }));

    expect(reports.computeAndStore).toHaveBeenCalledWith('2026-10-30');
    expect(sender.sendOnce).toHaveBeenCalledWith(
      'daily-report',
      '2026-10-30:admin@shop.test',
      expect.anything(),
    );
    expect(sender.sendOnce).toHaveBeenCalledWith(
      'daily-report',
      '2026-10-30:boss@shop.test',
      expect.anything(),
    );
  });

  it('survives a Redis outage at startup', async () => {
    const { processor, queue } = reportSetup();
    queue.upsertJobScheduler.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

describe('previousBusinessDay', () => {
  it('uses Vietnam time, not the UTC server clock', () => {
    // 2026-10-31 18:00 UTC is already 2026-11-01 01:00 in Vietnam → yesterday = 2026-10-31.
    expect(previousBusinessDay(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10-31');
    expect(previousBusinessDay(new Date('2026-10-31T10:00:00Z'))).toBe('2026-10-30');
  });
});
