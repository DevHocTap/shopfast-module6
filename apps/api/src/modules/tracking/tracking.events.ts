import { OrderStatus } from '../orders/order-state-machine';

/**
 * Socket.IO contract of order tracking (F02). The web client mirrors these names and shapes in
 * `apps/web/src/lib/tracking.ts`.
 */
export const TRACKING_NAMESPACE = '/tracking';

export const TrackingEvents = {
  /** client → server, with ack: `{ orderId }` → SubscribeAck */
  subscribe: 'order:subscribe',
  /** client → server, with ack: `{ orderId }` → `{ ok: true }` */
  unsubscribe: 'order:unsubscribe',
  /** server → client */
  status: 'order:status',
} as const;

export interface OrderStatusEvent {
  orderId: string;
  /** Human-readable order code (SF-XXXXXXXX), for list screens. */
  code: string;
  status: OrderStatus;
  /** ISO time of the change (orders.updated_at). */
  changedAt: string;
  /** orders.version after the change: clients drop events older than what they already show. */
  version: number;
}

export type SubscribeError = 'BAD_REQUEST' | 'FORBIDDEN' | 'TOO_MANY_SUBSCRIPTIONS' | 'INTERNAL';
export type SubscribeAck = { ok: true } | { ok: false; error: SubscribeError };

/** Codes carried by `connect_error` when the handshake is refused. */
export type HandshakeError = 'UNAUTHORIZED' | 'TOKEN_EXPIRED';

export const orderRoom = (orderId: string): string => `order:${orderId}`;
/** Joined automatically at connection: every change to the user's own orders (list screens). */
export const userRoom = (userId: string): string => `user:${userId}`;
/** Joined automatically by support, warehouse and admin sockets: every order change. */
export const STAFF_ROOM = 'staff';
