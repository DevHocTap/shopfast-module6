import { io, Socket } from 'socket.io-client';
import { currentAccessToken } from './api-client';
import type { OrderStatus } from './types';

/** Mirrors `apps/api/src/modules/tracking/tracking.events.ts`. */
export const TrackingEvents = {
  subscribe: 'order:subscribe',
  unsubscribe: 'order:unsubscribe',
  status: 'order:status',
} as const;

export interface OrderStatusEvent {
  orderId: string;
  status: OrderStatus;
  changedAt: string;
  version: number;
}

export type SubscribeAck =
  | { ok: true }
  | { ok: false; error: 'BAD_REQUEST' | 'FORBIDDEN' | 'TOO_MANY_SUBSCRIPTIONS' | 'INTERNAL' };

let socket: Socket | null = null;
let holders = 0;

/**
 * One Socket.IO connection for the whole tab, opened while at least one screen needs it.
 * WebSocket only: no long-polling session that would have to stick to one api instance
 * while blue/green switches traffic.
 */
export function acquireTrackingSocket(): Socket {
  socket ??= io('/tracking', {
    autoConnect: false,
    transports: ['websocket'],
    // Read at every (re)connection, so a renewed access token is picked up.
    auth: (send) => send({ token: currentAccessToken() }),
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
  });
  holders += 1;
  if (!socket.active) socket.connect();
  return socket;
}

export function releaseTrackingSocket(): void {
  holders = Math.max(0, holders - 1);
  if (holders === 0) socket?.disconnect();
}

/** After logout or an account switch: the open socket is still authenticated as the old user. */
export function resetTrackingSocket(): void {
  if (!socket) return;
  socket.disconnect();
  if (holders > 0) socket.connect();
}
