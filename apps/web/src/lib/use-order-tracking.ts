import { useEffect, useRef, useState } from 'react';
import { refreshAccessToken } from './api-client';
import {
  acquireTrackingSocket,
  OrderStatusEvent,
  releaseTrackingSocket,
  SubscribeAck,
  TrackingEvents,
} from './tracking';

export type TrackingStatus = 'connecting' | 'live' | 'reconnecting' | 'unavailable';

interface Handlers {
  /** A status change pushed by the server for this order. */
  onStatus(event: OrderStatusEvent): void;
  /** Back after a disconnection: events sent meanwhile are lost, re-read the order over REST. */
  onResync(): void;
}

const ACK_TIMEOUT_MS = 5_000;
const MAX_AUTH_RETRIES = 3;

/**
 * Follows one order in realtime (F02). Socket.IO reconnects on its own after a network loss;
 * this hook re-subscribes on every `connect` and asks for a REST resync, so a customer who was
 * offline for a while still ends up on the right status without reloading the page.
 */
export function useOrderTracking(orderId: string | undefined, handlers: Handlers): TrackingStatus {
  const [status, setStatus] = useState<TrackingStatus>('connecting');
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!orderId) return;
    const socket = acquireTrackingSocket();
    let disposed = false;
    let subscribedBefore = false;
    let authRetries = 0;
    let timer: number | undefined;
    setStatus('connecting');

    const subscribe = async () => {
      try {
        const ack = (await socket
          .timeout(ACK_TIMEOUT_MS)
          .emitWithAck(TrackingEvents.subscribe, { orderId })) as SubscribeAck;
        if (disposed) return;
        if (!ack.ok) {
          setStatus('unavailable');
          return;
        }
        setStatus('live');
        authRetries = 0;
        if (subscribedBefore) handlersRef.current.onResync();
        subscribedBefore = true;
      } catch {
        // No ack in time (server busy or connection dropped meanwhile): try again shortly.
        if (disposed) return;
        setStatus('reconnecting');
        timer = window.setTimeout(() => socket.connected && void subscribe(), 2_000);
      }
    };

    // Refused at the handshake (token missing or expired) or closed by the server when the
    // token expired: Socket.IO does not retry those, so renew the token and reconnect.
    const renewAndReconnect = async () => {
      if (authRetries >= MAX_AUTH_RETRIES) {
        setStatus('unavailable');
        return;
      }
      authRetries += 1;
      const token = await refreshAccessToken();
      if (disposed) return;
      if (!token) {
        setStatus('unavailable');
        return;
      }
      timer = window.setTimeout(() => socket.connect(), 500 * authRetries);
    };

    const onConnect = () => void subscribe();
    const onDisconnect = (reason: string) => {
      if (disposed) return;
      setStatus('reconnecting');
      if (reason === 'io server disconnect') void renewAndReconnect();
    };
    const onConnectError = () => {
      if (disposed) return;
      setStatus('reconnecting');
      // Still `active`: a network problem, Socket.IO keeps retrying with backoff by itself.
      if (!socket.active) void renewAndReconnect();
    };
    const onStatus = (event: OrderStatusEvent) => {
      if (event.orderId === orderId) handlersRef.current.onStatus(event);
    };

    // The browser knows about a network loss long before Socket.IO's ping timeout (~45 s) does.
    const onOffline = () => !disposed && setStatus('reconnecting');
    const onOnline = () => {
      if (disposed) return;
      if (socket.connected) {
        void subscribe(); // already in the room: acks ok, and triggers the REST resync
      } else {
        if (!socket.active) socket.connect();
        handlersRef.current.onResync();
      }
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on(TrackingEvents.status, onStatus);
    if (socket.connected) void subscribe();

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off(TrackingEvents.status, onStatus);
      if (socket.connected) socket.emit(TrackingEvents.unsubscribe, { orderId });
      releaseTrackingSocket();
    };
  }, [orderId]);

  return status;
}
