import { OrderStatusEvent } from './tracking.events';

/**
 * Port used by OrdersService right after a status change is committed. Realtime is the fast but
 * lossy channel: implementations must never throw (clients re-read the order over REST anyway).
 */
export abstract class OrderTrackingPublisher {
  /** Placed or changed: reaches the order's room, its owner's sockets and every staff socket. */
  abstract orderStatusChanged(event: OrderStatusEvent, ownerId: string): void;
}
