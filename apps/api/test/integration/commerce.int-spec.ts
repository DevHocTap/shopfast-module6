import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, resetDatabase } from '../utils/test-app';

interface Session {
  token: string;
  cookie: string;
  userId: string;
}

describe('Commerce core (integration: real PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let http: ReturnType<typeof request>;
  const ids = {
    category: randomUUID(),
    brand: randomUUID(),
    limited: randomUUID(),
    plenty: randomUUID(),
    retired: randomUUID(),
  };
  let counter = 0;

  const register = async (prefix = 'user'): Promise<Session> => {
    const res = await http
      .post('/api/auth/register')
      .send({
        email: `${prefix}${++counter}@test.local`,
        password: 'Password123',
        fullName: 'Người Thử',
      })
      .expect(201);
    return {
      token: res.body.accessToken as string,
      cookie: (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0],
      userId: res.body.user.id as string,
    };
  };
  const auth = (s: Session) => ({ Authorization: `Bearer ${s.token}` });
  const addToCart = (s: Session, productId: string, quantity: number) =>
    http.put(`/api/cart/items/${productId}`).set(auth(s)).send({ quantity }).expect(200);
  const placeOrder = (s: Session, key = randomUUID()) =>
    http.post('/api/orders').set(auth(s)).set('Idempotency-Key', key);
  const stockOf = async (productId: string) =>
    Number(
      (await db.query('SELECT quantity FROM inventories WHERE product_id = $1', [productId]))[0]
        .quantity,
    );

  beforeAll(async () => {
    ({ app, dataSource: db } = await createTestApp());
    http = request(app.getHttpServer());
    await resetDatabase(db);
    await db.query(`INSERT INTO categories (id, name, slug) VALUES ($1, 'Tai nghe', 'tai-nghe')`, [
      ids.category,
    ]);
    await db.query(`INSERT INTO brands (id, name, slug) VALUES ($1, 'Sony', 'sony')`, [ids.brand]);
    await db.query(
      `INSERT INTO products (id, sku, name, category_id, brand_id, price, is_active) VALUES
         ($1, 'SKU-LIMITED', 'Tai nghe giới hạn', $4, $5, 100000, true),
         ($2, 'SKU-PLENTY',  'Tai nghe phổ thông', $4, $5, 250000, true),
         ($3, 'SKU-RETIRED', 'Tai nghe ngừng bán', $4, $5, 50000, false)`,
      [ids.limited, ids.plenty, ids.retired, ids.category, ids.brand],
    );
    await db.query(
      `INSERT INTO inventories (product_id, quantity) VALUES ($1, 10), ($2, 1000), ($3, 5)`,
      [ids.limited, ids.plenty, ids.retired],
    );
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  describe('authentication', () => {
    it('registers, rotates the refresh token, and kills the family when an old token is replayed', async () => {
      const s = await register();
      expect(s.cookie).toMatch(/^sf_refresh=/);
      await http.get('/api/me').set(auth(s)).expect(200);

      const rotated = await http.post('/api/auth/refresh').set('Cookie', s.cookie).expect(200);
      const newCookie = (rotated.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      expect(newCookie).not.toEqual(s.cookie);

      // Replaying the consumed token = theft signal: it fails AND the fresh token dies with it.
      await http.post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
      await http.post('/api/auth/refresh').set('Cookie', newCookie).expect(401);
    });

    it('sets the refresh cookie as httpOnly and SameSite=Strict, scoped to /api/auth', async () => {
      const res = await http
        .post('/api/auth/register')
        .send({
          email: `cookie${++counter}@test.local`,
          password: 'Password123',
          fullName: 'Người Thử',
        })
        .expect(201);
      const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/auth/);
    });

    it('rejects bad credentials and duplicate emails with Vietnamese messages', async () => {
      await http
        .post('/api/auth/register')
        .send({ email: 'dup@test.local', password: 'Password123', fullName: 'A B' })
        .expect(201);
      const dup = await http
        .post('/api/auth/register')
        .send({ email: 'DUP@test.local', password: 'Password123', fullName: 'A B' })
        .expect(409);
      expect(dup.body.code).toBe('EMAIL_TAKEN');

      const bad = await http
        .post('/api/auth/login')
        .send({ email: 'dup@test.local', password: 'wrong-pass' })
        .expect(401);
      expect(bad.body).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    });

    it('requires a token (401) and the right role (403)', async () => {
      await http.get('/api/cart').expect(401);
      const customer = await register();
      const res = await http.get('/api/warehouse/orders').set(auth(customer)).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('catalog', () => {
    it('filters by price, hides discontinued products and paginates', async () => {
      const res = await http.get('/api/products').query({ minPrice: 200000, limit: 1 }).expect(200);
      expect(res.body).toMatchObject({ total: 1, totalPages: 1, page: 1 });
      expect(res.body.items[0]).toMatchObject({
        sku: 'SKU-PLENTY',
        inStock: true,
        brand: { name: 'Sony' },
      });

      const all = await http.get('/api/products').expect(200);
      expect((all.body as { items: { sku: string }[] }).items.map((p) => p.sku)).not.toContain(
        'SKU-RETIRED',
      );
      await http.get(`/api/products/${ids.retired}`).expect(404);
    });

    it('treats % in the search text literally', async () => {
      const res = await http.get('/api/products').query({ q: '%' }).expect(200);
      expect(res.body.total).toBe(0);
    });
  });

  describe('placing orders', () => {
    it('never oversells: 50 concurrent buyers for 10 units → exactly 10 orders', async () => {
      const buyers = await Promise.all(Array.from({ length: 50 }, () => register('buyer')));
      await Promise.all(buyers.map((b) => addToCart(b, ids.limited, 1)));

      const responses = await Promise.all(buyers.map((b) => placeOrder(b)));
      const statuses = responses.map((r) => r.status);

      expect(statuses.filter((s) => s === 201)).toHaveLength(10);
      expect(statuses.filter((s) => s === 409)).toHaveLength(40);
      expect(responses.find((r) => r.status === 409)?.body.code).toBe('OUT_OF_STOCK');
      expect(await stockOf(ids.limited)).toBe(0);
      const [{ sold }] = await db.query(
        `SELECT COALESCE(-sum(delta), 0)::int AS sold FROM inventory_movements WHERE product_id = $1 AND reason = 'ORDER'`,
        [ids.limited],
      );
      expect(sold).toBe(10);
    }, 60_000);

    it('creates one order per Idempotency-Key, even for simultaneous duplicates', async () => {
      const s = await register();
      await addToCart(s, ids.plenty, 2);
      const key = randomUUID();

      const [a, b] = await Promise.all([placeOrder(s, key), placeOrder(s, key)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.id).toBe(b.body.id);

      const again = await placeOrder(s, key).expect(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      const [{ count }] = await db.query(
        'SELECT count(*)::int AS count FROM orders WHERE user_id = $1',
        [s.userId],
      );
      expect(count).toBe(1);
    });

    it('charges the database price and refuses discontinued products and empty carts', async () => {
      const s = await register();
      await placeOrder(s).expect(400);

      await addToCart(s, ids.plenty, 3);
      const order = await placeOrder(s).expect(201);
      expect(order.body).toMatchObject({
        status: 'PENDING_PAYMENT',
        subtotal: 750000,
        total: 750000,
      });
      expect(order.body.code).toMatch(/^SF-/);

      const cart = await http.get('/api/cart').set(auth(s)).expect(200);
      expect(cart.body.items).toHaveLength(0);

      await http
        .put(`/api/cart/items/${ids.retired}`)
        .set(auth(s))
        .send({ quantity: 1 })
        .expect(404);
    });
  });

  describe('inventory', () => {
    it('lets the warehouse count stock and logs the difference as an ADJUST movement', async () => {
      const staff = await register('kiemke');
      await db.query(`UPDATE users SET role = 'WAREHOUSE' WHERE id = $1`, [staff.userId]);
      const login = await http
        .post('/api/auth/login')
        .send({ email: `kiemke${counter}@test.local`, password: 'Password123' })
        .expect(200);
      const wh = { Authorization: `Bearer ${login.body.accessToken}` };

      const before = await http.get('/api/inventory/sku-plenty').set(wh).expect(200);
      const updated = await http
        .put(`/api/inventory/${ids.plenty}`)
        .set(wh)
        .send({ quantity: before.body.quantity + 5 })
        .expect(200);
      expect(updated.body.quantity).toBe(before.body.quantity + 5);

      const [movement] = await db.query(
        `SELECT delta, reason, actor_id FROM inventory_movements
          WHERE product_id = $1 ORDER BY id DESC LIMIT 1`,
        [ids.plenty],
      );
      expect(movement).toMatchObject({ delta: 5, reason: 'ADJUST', actor_id: staff.userId });

      const customer = await register();
      await http
        .put(`/api/inventory/${ids.plenty}`)
        .set(auth(customer))
        .send({ quantity: 0 })
        .expect(403);
    });
  });

  describe('order lifecycle', () => {
    it('pay → warehouse packing (optimistic version) → customer cannot cancel → warehouse cancels and stock returns', async () => {
      const customer = await register();
      const other = await register();
      const staff = await register('kho');
      await db.query(`UPDATE users SET role = 'WAREHOUSE' WHERE id = $1`, [staff.userId]);
      const warehouse = await http
        .post('/api/auth/login')
        .send({ email: `kho${counter}@test.local`, password: 'Password123' })
        .expect(200);
      const wh = { Authorization: `Bearer ${warehouse.body.accessToken}` };

      await addToCart(customer, ids.plenty, 4);
      const before = await stockOf(ids.plenty);
      const placed = await placeOrder(customer).expect(201);
      const orderId = placed.body.id as string;
      expect(await stockOf(ids.plenty)).toBe(before - 4);

      await http.get(`/api/orders/${orderId}`).set(auth(other)).expect(404);
      const paid = await http.post(`/api/orders/${orderId}/pay`).set(auth(customer)).expect(200);
      expect(paid.body).toMatchObject({ status: 'PAID', payment: { amount: 1000000 } });
      await http.post(`/api/orders/${orderId}/pay`).set(auth(customer)).expect(409);

      const packing = await http
        .patch(`/api/warehouse/orders/${orderId}/status`)
        .set(wh)
        .send({ status: 'PACKING', version: paid.body.version })
        .expect(200);
      const stale = await http
        .patch(`/api/warehouse/orders/${orderId}/status`)
        .set(wh)
        .send({ status: 'SHIPPED', version: paid.body.version })
        .expect(409);
      expect(stale.body.code).toBe('STALE_ORDER');
      const skip = await http
        .patch(`/api/warehouse/orders/${orderId}/status`)
        .set(wh)
        .send({ status: 'DELIVERED', version: packing.body.version })
        .expect(409);
      expect(skip.body.code).toBe('INVALID_TRANSITION');

      await http.post(`/api/orders/${orderId}/cancel`).set(auth(customer)).expect(409);
      const cancelled = await http
        .patch(`/api/warehouse/orders/${orderId}/status`)
        .set(wh)
        .send({ status: 'CANCELLED', version: packing.body.version })
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect((cancelled.body as { history: { to: string }[] }).history.map((h) => h.to)).toEqual([
        'PENDING_PAYMENT',
        'PAID',
        'PACKING',
        'CANCELLED',
      ]);
      expect(await stockOf(ids.plenty)).toBe(before);

      const list = await http
        .get('/api/warehouse/orders')
        .query({ status: 'CANCELLED' })
        .set(wh)
        .expect(200);
      expect((list.body as { items: { id: string }[] }).items.map((o) => o.id)).toContain(orderId);
      const mine = await http.get('/api/orders').set(auth(customer)).expect(200);
      expect(mine.body.total).toBe(1);
    });
  });
});
