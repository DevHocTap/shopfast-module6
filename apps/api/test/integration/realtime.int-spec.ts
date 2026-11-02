import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { NestExpressApplication } from '@nestjs/platform-express';
import { io, Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { createTestApp, httpClient, HttpClient, resetDatabase } from '../utils/test-app';

interface StatusEvent {
  orderId: string;
  status: string;
  changedAt: string;
  version: number;
}

/**
 * F02 end to end, with TWO api instances sharing PostgreSQL and Redis (as during a blue/green
 * switch): HTTP requests go to instance A, sockets are held by instance B, so every event that
 * arrives proves the Redis adapter carries it across instances.
 */
describe('Order tracking over Socket.IO (integration: 2 api instances + Redis adapter)', () => {
  let appA: NestExpressApplication;
  let appB: NestExpressApplication;
  let db: DataSource;
  let http: HttpClient;
  let socketUrl: string;
  const sockets: Socket[] = [];
  const productId = randomUUID();
  let counter = 0;

  const register = async (prefix = 'khach') => {
    const email = `${prefix}${++counter}@test.local`;
    const res = await http
      .post('/api/auth/register')
      .send({ email, password: 'Password123', fullName: 'Người Thử' })
      .expect(201);
    return { token: res.body.accessToken as string, userId: res.body.user.id as string, email };
  };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const paidOrder = async (token: string) => {
    await http
      .put(`/api/cart/items/${productId}`)
      .set(bearer(token))
      .send({ quantity: 1 })
      .expect(200);
    const placed = await http
      .post('/api/orders')
      .set(bearer(token))
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const paid = await http
      .post(`/api/orders/${placed.body.id}/pay`)
      .set(bearer(token))
      .expect(200);
    return { id: paid.body.id as string, version: paid.body.version as number };
  };

  const connect = (token?: string): Socket => {
    const socket = io(`${socketUrl}/tracking`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      forceNew: true,
      reconnectionDelay: 100,
      reconnectionDelayMax: 200,
    });
    sockets.push(socket);
    return socket;
  };
  const connected = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
  const subscribe = (socket: Socket, orderId: string) =>
    socket.timeout(2_000).emitWithAck('order:subscribe', { orderId }) as Promise<{
      ok: boolean;
      error?: string;
    }>;
  const nextStatus = (socket: Socket, timeoutMs = 2_000) =>
    new Promise<StatusEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no order:status event')), timeoutMs);
      socket.once('order:status', (event: StatusEvent) => {
        clearTimeout(timer);
        resolve(event);
      });
    });

  let warehouse: string;
  const moveTo = (orderId: string, status: string, version: number) =>
    http
      .patch(`/api/warehouse/orders/${orderId}/status`)
      .set(bearer(warehouse))
      .send({ status, version })
      .expect(200);

  beforeAll(async () => {
    ({ app: appA, dataSource: db } = await createTestApp());
    ({ app: appB } = await createTestApp());
    await appB.listen(0, '127.0.0.1');
    socketUrl = `http://127.0.0.1:${(appB.getHttpServer().address() as AddressInfo).port}`;
    http = httpClient(appA);
    await resetDatabase(appA);

    const category = randomUUID();
    const brand = randomUUID();
    await db.query(`INSERT INTO categories (id, name, slug) VALUES ($1, 'Loa', 'loa')`, [category]);
    await db.query(`INSERT INTO brands (id, name, slug) VALUES ($1, 'JBL', 'jbl')`, [brand]);
    await db.query(
      `INSERT INTO products (id, sku, name, category_id, brand_id, price, is_active)
       VALUES ($1, 'SKU-LOA', 'Loa di động', $2, $3, 500000, true)`,
      [productId, category, brand],
    );
    await db.query(`INSERT INTO inventories (product_id, quantity) VALUES ($1, 100)`, [productId]);

    const staff = await register('kho');
    await db.query(`UPDATE users SET role = 'WAREHOUSE' WHERE id = $1`, [staff.userId]);
    const login = await http
      .post('/api/auth/login')
      .send({ email: staff.email, password: 'Password123' })
      .expect(200);
    warehouse = login.body.accessToken as string;
  }, 90_000);

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await appB.close();
    await appA.close();
  });

  it('refuses the handshake without a valid access token', async () => {
    await expect(connected(connect())).rejects.toMatchObject({
      message: 'UNAUTHORIZED',
      data: { code: 'UNAUTHORIZED' },
    });
    await expect(connected(connect('not-a-jwt'))).rejects.toMatchObject({
      message: 'UNAUTHORIZED',
    });
  });

  it("lets a customer follow their own order but not another customer's", async () => {
    const an = await register();
    const binh = await register();
    const order = await paidOrder(an.token);

    const anSocket = connect(an.token);
    const binhSocket = connect(binh.token);
    await Promise.all([connected(anSocket), connected(binhSocket)]);

    await expect(subscribe(anSocket, order.id)).resolves.toEqual({ ok: true });
    await expect(subscribe(binhSocket, order.id)).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    await expect(subscribe(binhSocket, randomUUID())).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    await expect(subscribe(binhSocket, 'not-a-uuid')).resolves.toEqual({
      ok: false,
      error: 'BAD_REQUEST',
    });
  });

  it('delivers a warehouse change in under 1 s, only to the watchers of that order', async () => {
    const an = await register();
    const binh = await register();
    const anOrder = await paidOrder(an.token);
    const binhOrder = await paidOrder(binh.token);

    const anSocket = connect(an.token);
    const binhSocket = connect(binh.token);
    await Promise.all([connected(anSocket), connected(binhSocket)]);
    await subscribe(anSocket, anOrder.id);
    await subscribe(binhSocket, binhOrder.id);
    const binhEvents: StatusEvent[] = [];
    binhSocket.on('order:status', (event: StatusEvent) => binhEvents.push(event));

    const received = nextStatus(anSocket);
    const startedAt = performance.now();
    const res = await moveTo(anOrder.id, 'PACKING', anOrder.version);
    const event = await received;
    const latencyMs = performance.now() - startedAt;

    expect(event).toEqual({
      orderId: anOrder.id,
      status: 'PACKING',
      changedAt: expect.any(String),
      version: res.body.version,
    });
    expect(latencyMs).toBeLessThan(1_000);
    // Give a misrouted event every chance to show up before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(binhEvents).toEqual([]);
  });

  it('lets staff follow any order', async () => {
    const an = await register();
    const order = await paidOrder(an.token);
    const staffSocket = connect(warehouse);
    await connected(staffSocket);

    await expect(subscribe(staffSocket, order.id)).resolves.toEqual({ ok: true });
    const received = nextStatus(staffSocket);
    await moveTo(order.id, 'PACKING', order.version);
    await expect(received).resolves.toMatchObject({ orderId: order.id, status: 'PACKING' });
  });

  it('keeps receiving after the connection drops, once the client re-subscribes', async () => {
    const an = await register();
    const order = await paidOrder(an.token);
    const socket = connect(an.token);
    // What the web hook does: (re-)subscribe on every connect.
    socket.on('connect', () => void subscribe(socket, order.id));
    await connected(socket);
    const packing = nextStatus(socket);
    const first = await moveTo(order.id, 'PACKING', order.version);
    await packing;

    // Network loss: the transport dies without a clean disconnect → Socket.IO reconnects itself.
    const reconnected = new Promise<void>((resolve) =>
      socket.io.once('reconnect', () => resolve()),
    );
    socket.io.engine.close();
    await reconnected;
    await new Promise((resolve) => setTimeout(resolve, 100)); // let the re-subscribe ack land

    const shipped = nextStatus(socket);
    await moveTo(order.id, 'SHIPPED', first.body.version as number);
    await expect(shipped).resolves.toMatchObject({ orderId: order.id, status: 'SHIPPED' });
  });
});
