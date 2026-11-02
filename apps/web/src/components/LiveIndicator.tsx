import { ReactNode } from 'react';
import { formatTime } from '../lib/format';
import { STATUS_LABEL } from '../lib/order-status';
import type { OrderStatusEvent } from '../lib/tracking';
import type { TrackingStatus } from '../lib/use-order-tracking';

const TEXT: Record<TrackingStatus, string> = {
  connecting: 'Đang kết nối để nhận cập nhật trực tiếp…',
  live: 'Tự cập nhật, không cần tải lại trang',
  reconnecting: 'Mất kết nối, đang thử kết nối lại…',
  unavailable: 'Không nhận được cập nhật trực tiếp. Tải lại trang để xem dữ liệu mới nhất.',
};

const DOT: Record<TrackingStatus, string> = {
  connecting: 'bg-muted',
  live: 'bg-success-700',
  reconnecting: 'bg-warning-700',
  unavailable: 'bg-danger-700',
};

const TONE: Record<TrackingStatus, string> = {
  connecting: 'text-muted',
  live: 'text-muted',
  reconnecting: 'text-warning-700',
  unavailable: 'text-danger-700',
};

/**
 * Whether the screen is live, plus what just changed (`children`, shown while live).
 * A polite live region: screen readers announce changes without interrupting.
 */
export function LiveIndicator({
  status,
  children,
  className = '',
}: {
  status: TrackingStatus;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`flex items-start gap-2 text-sm ${TONE[status]} ${className}`}
    >
      {/* h-5 = one line of text-sm: the dot stays on the first line when the text wraps. */}
      <span className="flex h-5 shrink-0 items-center" aria-hidden>
        <span className={`size-2 rounded-full transition-colors duration-200 ${DOT[status]}`} />
      </span>
      <span>
        {TEXT[status]}
        {status === 'live' && children && (
          <>
            {' · '}
            <span className="font-medium text-ink">{children}</span>
          </>
        )}
      </span>
    </p>
  );
}

/** "Đơn SF-7KQ2M9XA vừa chuyển sang “Đang giao” lúc 09:21:49" — the code never breaks mid-line. */
export function OrderChange({ event }: { event: OrderStatusEvent }) {
  const what =
    event.status === 'PENDING_PAYMENT'
      ? 'vừa được đặt'
      : `vừa chuyển sang “${STATUS_LABEL[event.status]}”`;
  return (
    <>
      Đơn <span className="whitespace-nowrap">{event.code}</span> {what} lúc{' '}
      {formatTime(event.changedAt)}
    </>
  );
}
