import { ChevronRight, ReceiptText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { LiveIndicator, OrderChange } from '../../components/LiveIndicator';
import { ButtonLink } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api-client';
import { formatDateTime, formatVND } from '../../lib/format';
import type { OrderSummary, Paginated } from '../../lib/types';
import { useAsync } from '../../lib/use-async';
import { useOrderFeed } from '../../lib/use-order-feed';
import { OrderStatusBadge } from './OrderStatusBadge';

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const { state, reload } = useAsync(
    () => api<Paginated<OrderSummary>>('/orders', { query: { page, limit: 10 } }),
    [page],
  );
  const live = useOrderFeed(() => void reload());

  return (
    <>
      <PageHeader
        title="Đơn hàng của tôi"
        description={
          <>
            Theo dõi trạng thái và lịch sử mua hàng.
            <LiveIndicator status={live.status} className="mt-2">
              {live.lastChange && <OrderChange event={live.lastChange} />}
            </LiveIndicator>
          </>
        }
      />

      {state.status === 'loading' && (
        <div className="flex flex-col gap-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}
      {state.status === 'error' && (
        <ErrorState message={errorMessage(state.error)} onRetry={() => void reload()} />
      )}
      {state.status === 'success' && state.data.items.length === 0 && (
        <EmptyState
          icon={ReceiptText}
          title="Bạn chưa có đơn hàng nào"
          description="Đơn hàng sẽ xuất hiện ở đây ngay khi bạn đặt mua."
          action={<ButtonLink to="/">Bắt đầu mua sắm</ButtonLink>}
        />
      )}
      {state.status === 'success' && state.data.items.length > 0 && (
        <>
          <Card>
            <ul className="divide-y divide-border">
              {state.data.items.map((order) => (
                <li key={order.id}>
                  <Link
                    to={`/orders/${order.id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 p-4 transition-colors duration-150 hover:bg-canvas sm:grid-cols-[1fr_auto_8rem_auto] sm:gap-x-6 sm:p-6"
                  >
                    <div className="min-w-0">
                      <p className="font-mono font-medium">{order.code}</p>
                      <p className="mt-1 text-sm text-muted">
                        {formatDateTime(order.createdAt)} · {order.itemCount} sản phẩm
                      </p>
                    </div>
                    {/* Phones: code + total on top, status below; wider screens: one row. */}
                    <div className="row-start-2 sm:col-start-2 sm:row-start-1">
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <span className="col-start-2 row-start-1 text-right font-semibold tabular-nums sm:col-start-3">
                      {formatVND(order.total)}
                    </span>
                    <ChevronRight
                      className="hidden size-4 text-muted sm:col-start-4 sm:row-start-1 sm:block"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Pagination
            page={page}
            totalPages={state.data.totalPages}
            onChange={(next) => setParams({ page: String(next) })}
          />
        </>
      )}
    </>
  );
}
