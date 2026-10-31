import { ChevronRight, ReceiptText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { ButtonLink } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api-client';
import { formatDateTime, formatVND } from '../../lib/format';
import type { OrderSummary, Paginated } from '../../lib/types';
import { useAsync } from '../../lib/use-async';
import { OrderStatusBadge } from './OrderStatusBadge';

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const { state, reload } = useAsync(
    () => api<Paginated<OrderSummary>>('/orders', { query: { page, limit: 10 } }),
    [page],
  );

  return (
    <>
      <PageHeader title="Đơn hàng của tôi" description="Theo dõi trạng thái và lịch sử mua hàng." />

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
                    className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 transition-colors duration-150 hover:bg-canvas sm:p-6"
                  >
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="font-mono font-medium">{order.code}</p>
                      <p className="mt-1 text-sm text-muted">
                        {formatDateTime(order.createdAt)} · {order.itemCount} sản phẩm
                      </p>
                    </div>
                    <OrderStatusBadge status={order.status} />
                    <span className="w-32 text-right font-semibold tabular-nums">
                      {formatVND(order.total)}
                    </span>
                    <ChevronRight className="size-4 text-muted" aria-hidden />
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
