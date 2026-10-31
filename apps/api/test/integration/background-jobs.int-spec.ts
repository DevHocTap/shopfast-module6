import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplicationContext } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { LogMailTransport, MAIL_TRANSPORT } from '../../src/infra/mail/mail.transport';
import { QUEUES } from '../../src/infra/queue/queue.constants';
import { EmailProcessor } from '../../src/modules/notifications/email.processor';
import {
  PARTNER_CLIENT,
  SimulatedPartnerClient,
} from '../../src/modules/partner-sync/partner-client';
import { WorkerModule } from '../../src/worker.module';
import { createTestApp, httpClient, HttpClient, resetDatabase } from '../utils/test-app';

/** Polls until `check` returns a truthy value (background work is asynchronous by design). */
async function eventually<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * F05 end to end with BOTH processes in-memory: the API writes the outbox, the worker's relay
 * publishes to real BullMQ queues on Redis, and real BullMQ workers run the processors.
 */
describe('Background jobs (integration: API + worker, real PostgreSQL + Redis + BullMQ)', () => {
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let db: DataSource;
  let http: HttpClient;
  let mail: LogMailTransport;
  let partner: SimulatedPartnerClient;
  const productId = randomUUID();
  const PASSWORD = 'Password123';
  let counter = 0;

  const register = async (role?: 'ADMIN') => {
    const email = `jobs${++counter}@test.local`;
    const res = await http
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Người Thử' })
      .expect(201);
    if (!role) return { email, token: res.body.accessToken as string };
    await db.query('UPDATE users SET role = $1 WHERE email = $2', [role, email]);
    const login = await http
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { email, token: login.body.accessToken as string };
  };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const count = async (sql: string, params: unknown[] = []) =>
    Number((await db.query(sql, params))[0].count);

  beforeAll(async () => {
    ({ app, dataSource: db } = await createTestApp());
    http = httpClient(app);
    await resetDatabase(app);

    // Capture emails in memory whatever MAIL_TRANSPORT the local .env selects.
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(new LogMailTransport())
      .compile();
    worker = moduleRef;
    await worker.init();
    mail = worker.get<LogMailTransport>(MAIL_TRANSPORT);
    partner = worker.get<SimulatedPartnerClient>(PARTNER_CLIENT);
    // Configuration is read when modules are imported, so the simulated partner is steered directly:
    // random() ≥ failure rate → success, random() = 0 → failure.
    partner.random = () => 1;

    const [category, brand] = [randomUUID(), randomUUID()];
    await db.query(`INSERT INTO categories (id, name, slug) VALUES ($1, 'Chuột', 'chuot')`, [
      category,
    ]);
    await db.query(`INSERT INTO brands (id, name, slug) VALUES ($1, 'Logitech', 'logitech')`, [
      brand,
    ]);
    await db.query(
      `INSERT INTO products (id, sku, name, category_id, brand_id, price)
       VALUES ($1, 'SKU-JOBS', 'Chuột không dây', $2, $3, 500000)`,
      [productId, category, brand],
    );
    await db.query('INSERT INTO inventories (product_id, quantity) VALUES ($1, 50)', [productId]);
  }, 60_000);

  afterAll(async () => {
    await worker.close();
    await app.close();
  });

  it('an order triggers confirmation email, invoice and partner sync — each exactly once', async () => {
    const customer = await register();
    await http
      .put(`/api/cart/items/${productId}`)
      .set(bearer(customer.token))
      .send({ quantity: 2 })
      .expect(200);
    const order = await http
      .post('/api/orders')
      .set(bearer(customer.token))
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const orderId = order.body.id as string;

    await eventually(
      async () =>
        (await count('SELECT count(*) FROM invoices WHERE order_id = $1', [orderId])) === 1,
    );
    await eventually(
      async () =>
        (await count(
          `SELECT count(*) FROM email_logs WHERE type = 'order-confirmation' AND ref_id = $1 AND status = 'SENT'`,
          [orderId],
        )) === 1,
    );
    await eventually(
      async () =>
        (await count('SELECT count(*) FROM partner_sync_logs WHERE product_id = $1', [
          productId,
        ])) >= 1,
    );

    expect(await count('SELECT count(*) FROM outbox_events WHERE published_at IS NULL')).toBe(0);
    const confirmations = mail.sent.filter(
      (m) => m.subject === `Xác nhận đơn hàng ${order.body.code}`,
    );
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].to).toBe(customer.email);

    // The same job delivered again (at-least-once) changes nothing.
    const emailProcessor = worker.get(EmailProcessor);
    const replay = { name: 'order-confirmation', data: { orderId } } as never;
    await expect(emailProcessor.process(replay)).resolves.toBe('already-sent');
    await expect(emailProcessor.process(replay)).resolves.toBe('already-sent');
    expect(
      mail.sent.filter((m) => m.subject === `Xác nhận đơn hàng ${order.body.code}`),
    ).toHaveLength(1);

    // The delayed payment reminder is waiting in its queue, 30 minutes out.
    const reminders = app.get<Queue>(getQueueToken(QUEUES.paymentReminder));
    const reminder = await reminders.getJob(`payment-reminder-${orderId}`);
    expect(reminder?.opts.delay).toBe(30 * 60_000);

    // The invoice is served to the owner only.
    const invoice = await http
      .get(`/api/orders/${orderId}/invoice`)
      .set(bearer(customer.token))
      .expect(200);
    expect(invoice.headers['content-type']).toMatch(/text\/html/);
    expect(invoice.text).toContain(order.body.code as string);
    const stranger = await register();
    await http.get(`/api/orders/${orderId}/invoice`).set(bearer(stranger.token)).expect(404);
  }, 60_000);

  it('a job that exhausts its retries lands in failed_jobs and can be re-run by an admin', async () => {
    const admin = await register('ADMIN');
    partner.random = () => 0; // the simulated partner is down…
    const queue = app.get<Queue>(getQueueToken(QUEUES.inventorySync));
    await queue.add('push-stock', { productId }, { jobId: 'dead-letter-demo', attempts: 1 });

    const [dead] = await eventually(async () => {
      const rows: { id: string; reason: string }[] = await db.query(
        `SELECT id, reason FROM failed_jobs WHERE job_id = 'dead-letter-demo'`,
      );
      return rows.length ? rows : null;
    });
    expect(dead.reason).toMatch(/giả lập/);

    const listed = await http.get('/api/admin/failed-jobs').set(bearer(admin.token)).expect(200);
    expect((listed.body as { id: string }[]).map((job) => job.id)).toContain(dead.id);

    partner.random = () => 1; // …and comes back
    await http.post(`/api/admin/failed-jobs/${dead.id}/retry`).set(bearer(admin.token)).expect(202);
    await http.post(`/api/admin/failed-jobs/${dead.id}/retry`).set(bearer(admin.token)).expect(409);
    await eventually(async () => {
      const rows: { retried_at: Date | null }[] = await db.query(
        'SELECT retried_at FROM failed_jobs WHERE id = $1',
        [dead.id],
      );
      return rows[0].retried_at !== null;
    });

    const stats = await http.get('/api/admin/queues').set(bearer(admin.token)).expect(200);
    expect(stats.body.queues).toHaveLength(5);
    expect(stats.body.pendingOutboxEvents).toBe(0);
  }, 60_000);

  it('runs the revenue report on demand (idempotent upsert) and emails the OTP code', async () => {
    const admin = await register('ADMIN');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
      new Date(),
    );

    await http
      .post('/api/admin/reports/daily-revenue')
      .set(bearer(admin.token))
      .send({ date: today })
      .expect(202);
    await http
      .post('/api/admin/reports/daily-revenue')
      .set(bearer(admin.token))
      .send({ date: today })
      .expect(202);
    const [report] = await eventually(async () => {
      const res = await http
        .get('/api/admin/reports/daily-revenue')
        .set(bearer(admin.token))
        .expect(200);
      const rows = res.body as { date: string; orderCount: number; revenue: number }[];
      return rows.length ? rows : null;
    });
    expect(report).toMatchObject({ date: today, orderCount: 1, revenue: 1_000_000 });
    expect(await count('SELECT count(*) FROM daily_revenue_reports')).toBe(1);

    await http.post('/api/auth/otp/send').send({ email: 'otp-mail@test.local' }).expect(202);
    const otpMail = await eventually(async () =>
      mail.sent.find((m) => m.to === 'otp-mail@test.local'),
    );
    expect(otpMail.subject).toMatch(/^Mã xác thực ShopFast: \d{6}$/);
  }, 60_000);
});
