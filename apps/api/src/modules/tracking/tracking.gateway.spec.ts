import { Namespace, Socket } from 'socket.io';
import { Role } from '../../common/auth/role.enum';
import { OrderStatus } from '../orders/order-state-machine';
import { MAX_SUBSCRIPTIONS, TrackingGateway } from './tracking.gateway';
import { HandshakeRejected, TrackingService } from './tracking.service';

const ORDER_ID = '3f6c1a52-8a1d-4b8e-9f0a-1c2d3e4f5a6b';
const customer = { id: 'u1', email: 'an@example.com', role: Role.CUSTOMER };

type Middleware = (socket: Socket, next: (error?: Error) => void) => void;

function setup(service: Partial<Record<keyof TrackingService, jest.Mock>> = {}) {
  const tracking = {
    authenticate: jest.fn(),
    parseOrderId: jest.fn((payload: { orderId?: string }) => payload?.orderId ?? null),
    canWatch: jest.fn().mockResolvedValue(true),
    ...service,
  };
  const gateway = new TrackingGateway(tracking as unknown as TrackingService);
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  let middleware: Middleware | undefined;
  const namespace = { use: (fn: Middleware) => (middleware = fn), to };
  gateway.afterInit(namespace as unknown as Namespace);
  return { gateway, tracking, middleware: middleware!, to, emit };
}

function fakeSocket(token?: unknown) {
  const rooms = new Set<string>(['socket-id']);
  return {
    handshake: { auth: { token } },
    data: { session: { user: customer, expiresAt: Date.now() + 60_000 } },
    rooms,
    join: jest.fn(async (room: string) => void rooms.add(room)),
    leave: jest.fn(async (room: string) => void rooms.delete(room)),
    disconnect: jest.fn(),
  };
}

const runMiddleware = (middleware: Middleware, socket: ReturnType<typeof fakeSocket>) =>
  new Promise<Error | undefined>((resolve) => middleware(socket as unknown as Socket, resolve));

describe('TrackingGateway handshake', () => {
  it('attaches the session when the token is valid', async () => {
    const session = { user: customer, expiresAt: Date.now() + 60_000 };
    const { middleware } = setup({ authenticate: jest.fn().mockResolvedValue(session) });
    const socket = fakeSocket('good');

    await expect(runMiddleware(middleware, socket)).resolves.toBeUndefined();
    expect(socket.data.session).toBe(session);
  });

  it('refuses the connection with a machine code and a Vietnamese message', async () => {
    const { middleware } = setup({
      authenticate: jest.fn().mockRejectedValue(new HandshakeRejected('TOKEN_EXPIRED')),
    });

    const error = await runMiddleware(middleware, fakeSocket('old'));

    expect(error?.message).toBe('TOKEN_EXPIRED');
    expect(error).toMatchObject({
      data: { code: 'TOKEN_EXPIRED', message: expect.stringContaining('hết hạn') },
    });
  });

  it('treats unexpected failures as unauthorized', async () => {
    const { middleware } = setup({ authenticate: jest.fn().mockRejectedValue(new Error('boom')) });

    expect((await runMiddleware(middleware, fakeSocket('x')))?.message).toBe('UNAUTHORIZED');
  });
});

describe('TrackingGateway session lifetime', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('closes the socket when the access token expires', () => {
    const { gateway } = setup();
    const socket = fakeSocket();
    socket.data.session.expiresAt = Date.now() + 5_000;

    gateway.handleConnection(socket as never);
    jest.advanceTimersByTime(4_999);
    expect(socket.disconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('forgets the timer of a socket that left', () => {
    const { gateway } = setup();
    const socket = fakeSocket();

    gateway.handleConnection(socket as never);
    gateway.handleDisconnect(socket as never);
    jest.runAllTimers();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});

describe('TrackingGateway subscriptions', () => {
  it('joins the order room when allowed', async () => {
    const { gateway } = setup();
    const socket = fakeSocket();

    await expect(gateway.subscribe(socket as never, { orderId: ORDER_ID })).resolves.toEqual({
      ok: true,
    });
    expect(socket.join).toHaveBeenCalledWith(`order:${ORDER_ID}`);
  });

  it('refuses orders the user may not follow, without joining', async () => {
    const { gateway } = setup({ canWatch: jest.fn().mockResolvedValue(false) });
    const socket = fakeSocket();

    await expect(gateway.subscribe(socket as never, { orderId: ORDER_ID })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads before touching the database', async () => {
    const { gateway, tracking } = setup();

    await expect(gateway.subscribe(fakeSocket() as never, { nope: 1 })).resolves.toEqual({
      ok: false,
      error: 'BAD_REQUEST',
    });
    expect(tracking.canWatch).not.toHaveBeenCalled();
  });

  it('answers INTERNAL instead of throwing when the check fails', async () => {
    const { gateway } = setup({ canWatch: jest.fn().mockRejectedValue(new Error('db down')) });

    await expect(gateway.subscribe(fakeSocket() as never, { orderId: ORDER_ID })).resolves.toEqual({
      ok: false,
      error: 'INTERNAL',
    });
  });

  it('caps how many orders one socket follows', async () => {
    const { gateway } = setup();
    const socket = fakeSocket();
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) socket.rooms.add(`order:${i}`);

    await expect(gateway.subscribe(socket as never, { orderId: ORDER_ID })).resolves.toEqual({
      ok: false,
      error: 'TOO_MANY_SUBSCRIPTIONS',
    });
  });

  it('is idempotent for an order already followed (re-subscribe after reconnect)', async () => {
    const { gateway, tracking } = setup();
    const socket = fakeSocket();
    socket.rooms.add(`order:${ORDER_ID}`);

    await expect(gateway.subscribe(socket as never, { orderId: ORDER_ID })).resolves.toEqual({
      ok: true,
    });
    expect(tracking.canWatch).not.toHaveBeenCalled();
  });

  it('leaves the room on unsubscribe', async () => {
    const { gateway } = setup();
    const socket = fakeSocket();

    await gateway.unsubscribe(socket as never, { orderId: ORDER_ID });
    expect(socket.leave).toHaveBeenCalledWith(`order:${ORDER_ID}`);
  });
});

describe('TrackingGateway as publisher', () => {
  const event = {
    orderId: ORDER_ID,
    status: OrderStatus.SHIPPED,
    changedAt: '2026-11-02T03:00:00.000Z',
    version: 4,
  };

  it('emits only to the room of that order', () => {
    const { gateway, to, emit } = setup();

    gateway.orderStatusChanged(event);

    expect(to).toHaveBeenCalledWith(`order:${ORDER_ID}`);
    expect(emit).toHaveBeenCalledWith('order:status', event);
  });

  it('never throws into the request that changed the order', () => {
    const { gateway, to } = setup();
    to.mockImplementation(() => {
      throw new Error('adapter broken');
    });

    expect(() => gateway.orderStatusChanged(event)).not.toThrow();
  });

  it('does nothing in a process without a WebSocket server', () => {
    const gateway = new TrackingGateway({} as TrackingService);

    expect(() => gateway.orderStatusChanged(event)).not.toThrow();
  });
});
