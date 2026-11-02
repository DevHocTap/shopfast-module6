import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { OrderTrackingPublisher } from './order-tracking.publisher';
import {
  OrderStatusEvent,
  orderRoom,
  SubscribeAck,
  TRACKING_NAMESPACE,
  TrackingEvents,
} from './tracking.events';
import { HandshakeRejected, SocketSession, TrackingService } from './tracking.service';

/** A socket may follow this many orders at once (an order page needs one). */
export const MAX_SUBSCRIPTIONS = 20;

const HANDSHAKE_MESSAGES = {
  UNAUTHORIZED: 'Bạn cần đăng nhập để theo dõi đơn hàng.',
  TOKEN_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
} as const;

interface SocketData {
  session: SocketSession;
  expiryTimer?: NodeJS.Timeout;
}
type TrackingSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
/** setTimeout's ceiling (~24.8 days); larger delays would fire immediately. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Namespace `/tracking` (F02). Authentication happens once, in the handshake middleware: a socket
 * without a valid access token is refused before it can emit anything. Each order is a room;
 * joining it requires owning the order (or being staff), so events only reach the right people.
 */
@WebSocketGateway({ namespace: TRACKING_NAMESPACE, serveClient: false })
export class TrackingGateway
  extends OrderTrackingPublisher
  implements OnGatewayInit<Namespace>, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TrackingGateway.name);
  private namespace?: Namespace;

  constructor(private readonly tracking: TrackingService) {
    super();
  }

  afterInit(namespace: Namespace): void {
    this.namespace = namespace;
    namespace.use((socket, next) => {
      this.tracking
        .authenticate((socket.handshake.auth as { token?: unknown } | undefined)?.token)
        .then((session) => {
          (socket as TrackingSocket).data.session = session;
          next();
        })
        .catch((error: unknown) => {
          const code = error instanceof HandshakeRejected ? error.code : 'UNAUTHORIZED';
          // `message` is the machine code (client switches on it); `data` carries the text.
          next(
            Object.assign(new Error(code), { data: { code, message: HANDSHAKE_MESSAGES[code] } }),
          );
        });
    });
  }

  handleConnection(socket: TrackingSocket): void {
    // The token was valid at the handshake only: close the socket when it expires, the client
    // renews its token and reconnects (and re-subscribes) on its own.
    const ttl = socket.data.session.expiresAt - Date.now();
    socket.data.expiryTimer = setTimeout(
      () => socket.disconnect(true),
      Math.min(Math.max(ttl, 0), MAX_TIMER_MS),
    );
  }

  handleDisconnect(socket: TrackingSocket): void {
    clearTimeout(socket.data.expiryTimer);
  }

  @SubscribeMessage(TrackingEvents.subscribe)
  async subscribe(
    @ConnectedSocket() socket: TrackingSocket,
    @MessageBody() payload: unknown,
  ): Promise<SubscribeAck> {
    const orderId = this.tracking.parseOrderId(payload);
    if (!orderId) return { ok: false, error: 'BAD_REQUEST' };
    const room = orderRoom(orderId);
    if (socket.rooms.has(room)) return { ok: true };
    // rooms always contains the socket's own id.
    if (socket.rooms.size > MAX_SUBSCRIPTIONS)
      return { ok: false, error: 'TOO_MANY_SUBSCRIPTIONS' };

    try {
      if (!(await this.tracking.canWatch(socket.data.session.user, orderId))) {
        return { ok: false, error: 'FORBIDDEN' };
      }
    } catch (error) {
      this.logger.error({ err: error, orderId }, 'Subscription check failed');
      return { ok: false, error: 'INTERNAL' };
    }
    await socket.join(room);
    return { ok: true };
  }

  @SubscribeMessage(TrackingEvents.unsubscribe)
  async unsubscribe(
    @ConnectedSocket() socket: TrackingSocket,
    @MessageBody() payload: unknown,
  ): Promise<{ ok: true }> {
    const orderId = this.tracking.parseOrderId(payload);
    if (orderId) await socket.leave(orderRoom(orderId));
    return { ok: true };
  }

  orderStatusChanged(event: OrderStatusEvent): void {
    // Undefined in processes without a WebSocket server (worker, unit tests).
    if (!this.namespace) return;
    try {
      this.namespace.to(orderRoom(event.orderId)).emit(TrackingEvents.status, event);
    } catch (error) {
      this.logger.warn({ err: error, orderId: event.orderId }, 'Realtime emit failed');
    }
  }
}
