import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { SECOND_DELETE_DELAY_MS } from '../../src/infra/cache/cache.service';
import { createTestApp, httpClient, HttpClient, resetDatabase } from '../utils/test-app';

/** F03 (rate limiting, brute force, OTP) and F04 (cache + invalidation) against real PG + Redis. */
describe('Protection and cache (integration: real PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let http: HttpClient;
  const ids = { category: randomUUID(), brand: randomUUID(), product: randomUUID() };
  const PASSWORD = 'Password123';
  let counter = 0;

  const register = async (role?: 'ADMIN') => {
    const email = `p2user${++counter}@test.local`;
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

  beforeAll(async () => {
    ({ app, dataSource: db } = await createTestApp());
    http = httpClient(app);
    await resetDatabase(app);
    await db.query(`INSERT INTO categories (id, name, slug) VALUES ($1, 'Loa', 'loa')`, [
      ids.category,
    ]);
    await db.query(`INSERT INTO brands (id, name, slug) VALUES ($1, 'JBL', 'jbl')`, [ids.brand]);
    await db.query(
      `INSERT INTO products (id, sku, name, category_id, brand_id, price)
       VALUES ($1, 'SKU-P2', 'Loa thử nghiệm', $2, $3, 1000000)`,
      [ids.product, ids.category, ids.brand],
    );
    await db.query('INSERT INTO inventories (product_id, quantity) VALUES ($1, 100)', [
      ids.product,
    ]);
    // Vouchers come from the migration; reset them to a known state.
    await db.query(`UPDATE vouchers SET remaining_uses = 100000 WHERE code = 'SALE10'`);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  describe('rate limiting (F03)', () => {
    it('limits login attempts per IP with 429, Retry-After and a Vietnamese message', async () => {
      const ip = '203.0.113.7';
      for (let i = 0; i < 10; i++) {
        await http
          .post('/api/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: `nobody${i}@test.local`, password: 'whatever1' })
          .expect(401);
      }
      const res = await http
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'nobody@test.local', password: 'whatever1' })
        .expect(429);

      expect(res.headers['retry-after']).toMatch(/^\d+$/);
      expect(res.body).toMatchObject({ code: 'TOO_MANY_REQUESTS', details: { policy: 'login' } });
      // A full 60 s window reads as "1 phút", shorter waits as "N giây".
      expect(res.body.message).toMatch(/Vui lòng thử lại sau \d+ (giây|phút)/);
    });

    it('locks the TARGET account after 5 wrong passwords even when every attempt comes from a new IP', async () => {
      const { email } = await register();
      for (let i = 0; i < 5; i++) {
        await http.post('/api/auth/login').send({ email, password: 'wrong-pass' }).expect(401);
      }

      // Even the correct password is refused while the account is locked.
      const locked = await http
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(429);
      expect(locked.body).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED' });
      expect(locked.body.message).toMatch(/Tài khoản tạm khoá/);
    });

    it('allows one OTP per minute per target email, whatever the sender IP', async () => {
      await http.post('/api/auth/otp/send').send({ email: 'otp@test.local' }).expect(202);
      const again = await http
        .post('/api/auth/otp/send')
        .send({ email: 'otp@test.local' })
        .expect(429);

      expect(again.body.details).toMatchObject({ policy: 'otpPerTarget' });
    });

    it('exposes the global budget in RateLimit headers and never limits health checks', async () => {
      const res = await http.get('/api/categories').expect(200);
      expect(Number(res.headers['ratelimit-limit'])).toBe(120);

      const health = await http.get('/api/health/live').expect(200);
      expect(health.headers['ratelimit-limit']).toBeUndefined();
    });
  });

  describe('promotional orders', () => {
    it('applies a voucher once per customer and rate-limits promo attempts', async () => {
      const { token } = await register();
      const order = (voucherCode: string) =>
        http
          .post('/api/orders')
          .set(bearer(token))
          .set('Idempotency-Key', randomUUID())
          .send({ voucherCode });
      await http
        .put(`/api/cart/items/${ids.product}`)
        .set(bearer(token))
        .send({ quantity: 1 })
        .expect(200);

      const first = await order('sale10').expect(201);
      expect(first.body).toMatchObject({
        subtotal: 1_000_000,
        discount: 100_000,
        total: 900_000,
        voucherCode: 'SALE10',
      });

      await http
        .put(`/api/cart/items/${ids.product}`)
        .set(bearer(token))
        .send({ quantity: 1 })
        .expect(200);
      const reused = await order('SALE10').expect(409);
      expect(reused.body.code).toBe('VOUCHER_ALREADY_USED');

      const invalid = await order('NOTREAL').expect(409);
      expect(invalid.body.code).toBe('VOUCHER_INVALID');

      // 3 promo attempts per minute: the 4th is refused before touching the database.
      const limited = await order('SALE10').expect(429);
      expect(limited.body.details).toMatchObject({ policy: 'promoOrder' });
    });
  });

  describe('cache (F04)', () => {
    it('serves the second read from Redis and shows a new price immediately after an update', async () => {
      const admin = await register('ADMIN');
      await http.delete('/api/admin/cache/stats').set(bearer(admin.token)).expect(204);

      const miss = await http.get(`/api/products/${ids.product}`).expect(200);
      const hit = await http.get(`/api/products/${ids.product}`).expect(200);
      expect(miss.headers['x-cache']).toBe('MISS');
      expect(hit.headers['x-cache']).toBe('HIT');
      expect(hit.headers['server-timing']).toMatch(/^app;dur=\d+(\.\d+)?$/);

      const list1 = await http.get('/api/products').query({ categoryId: ids.category }).expect(200);
      const list2 = await http.get('/api/products').query({ categoryId: ids.category }).expect(200);
      expect([list1.headers['x-cache'], list2.headers['x-cache']]).toEqual(['MISS', 'HIT']);

      await http
        .patch(`/api/admin/products/${ids.product}`)
        .set(bearer(admin.token))
        .send({ price: 1_234_000 })
        .expect(200);

      const detail = await http.get(`/api/products/${ids.product}`).expect(200);
      const list = await http.get('/api/products').query({ categoryId: ids.category }).expect(200);
      expect(detail.body.price).toBe(1_234_000);
      expect(list.body.items[0].price).toBe(1_234_000);

      const stats = await http.get('/api/admin/cache/stats').set(bearer(admin.token)).expect(200);
      expect(stats.body.hits).toBeGreaterThanOrEqual(2);
      expect(stats.body.redis).toBe('closed');
    });

    it('shows the new stock right after an order while the product itself stays cached', async () => {
      // Let the delayed second delete scheduled by the previous test's price update fire first.
      await new Promise((resolve) => setTimeout(resolve, SECOND_DELETE_DELAY_MS + 100));
      const before = await http.get(`/api/products/${ids.product}`).expect(200);
      const { token } = await register();
      await http
        .put(`/api/cart/items/${ids.product}`)
        .set(bearer(token))
        .send({ quantity: 3 })
        .expect(200);
      await http
        .post('/api/orders')
        .set(bearer(token))
        .set('Idempotency-Key', randomUUID())
        .expect(201);

      const after = await http.get(`/api/products/${ids.product}`).expect(200);
      expect(after.headers['x-cache']).toBe('HIT');
      expect(after.body.stock).toBe(before.body.stock - 3);
    });

    it('caches unknown ids too, so probing does not hit the database twice', async () => {
      const unknown = randomUUID();
      const first = await http.get(`/api/products/${unknown}`).expect(404);
      const second = await http.get(`/api/products/${unknown}`).expect(404);

      expect(first.headers['x-cache']).toBeUndefined(); // errors carry no cache header
      expect(second.body.code).toBe('PRODUCT_NOT_FOUND');
    });
  });
});
