import { useEffect, useRef, useState } from 'react';
import type { OrderStatusEvent } from './tracking';
import { TrackingStatus, useOrderTracking } from './use-order-tracking';

/**
 * Live list screens ("my orders", warehouse queue): any change to an order the user may see
 * re-reads the current page, so filters, paging and totals stay exactly what the API says.
 * Bursts (a warehouse clearing a queue) are coalesced into one reload.
 */
export function useOrderFeed(reload: () => void): {
  status: TrackingStatus;
  lastChange?: OrderStatusEvent;
} {
  const [lastChange, setLastChange] = useState<OrderStatusEvent>();
  const timer = useRef<number>();

  const status = useOrderTracking(null, {
    onStatus(event) {
      setLastChange(event);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(reload, 250);
    },
    onResync: reload,
  });

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { status, lastChange };
}
