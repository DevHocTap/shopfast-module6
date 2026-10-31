import { Inbox } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ConfirmButton } from '../../components/ui/ConfirmButton';
import { Pagination } from '../../components/ui/Pagination';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/States';
import { api, ApiError, errorMessage } from '../../lib/api-client';
import { formatDateTime, formatVND } from '../../lib/format';
import { STATUS_LABEL, WAREHOUSE_CANCELLABLE, WAREHOUSE_NEXT } from '../../lib/order-status';
import { useToast } from '../../lib/toast';
import type { OrderStatus, OrderSummary, Paginated } from '../../lib/types';
import { useAsync } from '../../lib/use-async';
import { OrderStatusBadge } from '../orders/OrderStatusBadge';

/** Work queues in the order a warehouse handles them. */
const TABS: { status: OrderStatus | ''; label: string }[] = [
  { status: 'PAID', label: 'Chờ đóng gói' },
  { status: 'PACKING', label: STATUS_LABEL.PACKING },
  { status: 'SHIPPED', label: STATUS_LABEL.SHIPPED },
  { status: 'PENDING_PAYMENT', label: STATUS_LABEL.PENDING_PAYMENT },
  { status: 'DELIVERED', label: STATUS_LABEL.DELIVERED },
  { status: 'CANCELLED', label: STATUS_LABEL.CANCELLED },
  { status: '', label: 'Tất cả' },
];

export function WarehouseSubnav() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-medium ${
      isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'
    }`;
  return (
    <nav className="mb-8 flex gap-6 border-b border-border" aria-label="Khu vực kho">
      <NavLink to="/warehouse" end className={link}>
        Đơn hàng
      </NavLink>
      <NavLink to="/warehouse/inventory" className={link}>
        Tồn kho
      </NavLink>
    </nav>
  );
}

export function WarehouseOrdersPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = (params.has('status') ? params.get('status') : 'PAID') as OrderStatus | '';
  const page = Number(params.get('page') ?? 1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { state, reload } = useAsync(
    () =>
      api<Paginated<OrderSummary>>('/warehouse/orders', {
        query: { status: status || undefined, page, limit: 20 },
      }),
    [status, page],
  );

  async function move(order: OrderSummary, to: OrderStatus) {
    setBusyId(order.id);
    try {
      await api(`/warehouse/orders/${order.id}/status`, {
        method: 'PATCH',
        body: { status: to, version: order.version },
      });
      toast.success(`${order.code}: ${STATUS_LABEL[to]}.`);
    } catch (error) {
      const stale = error instanceof ApiError && error.code === 'STALE_ORDER';
      toast.error(
        stale
          ? `${order.code} vừa được người khác cập nhật, danh sách đã tải lại.`
          : errorMessage(error),
      );
    } finally {
      setBusyId(null);
      void reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Kho"
        description="Xử lý đơn theo thứ tự: đóng gói → giao vận chuyển → xác nhận đã giao."
      />
      <WarehouseSubnav />

      <div
        className="mb-6 flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Lọc theo trạng thái"
      >
        {TABS.map((tab) => {
          const active = tab.status === status;
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setParams({ status: tab.status })}
              className={`min-h-11 shrink-0 rounded-sm px-3 text-sm font-medium transition-colors duration-150 ${
                active
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface text-muted ring-1 ring-inset ring-border hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {state.status === 'loading' && (
        <div className="flex flex-col gap-4" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}
      {state.status === 'error' && (
        <ErrorState message={errorMessage(state.error)} onRetry={() => void reload()} />
      )}
      {state.status === 'success' && state.data.items.length === 0 && (
        <EmptyState
          icon={Inbox}
          title="Không có đơn nào ở trạng thái này"
          description="Khi có đơn mới, chúng sẽ xuất hiện tại đây. Bạn có thể xem các trạng thái khác ở thanh lọc phía trên."
          action={
            <ButtonLink to="/warehouse?status=" variant="secondary">
              Xem tất cả đơn
            </ButtonLink>
          }
        />
      )}
      {state.status === 'success' && state.data.items.length > 0 && (
        <>
          <p className="mb-4 text-sm text-muted">{state.data.total.toLocaleString('vi-VN')} đơn</p>
          <Card>
            <ul className="divide-y divide-border">
              {state.data.items.map((order) => {
                const next = WAREHOUSE_NEXT[order.status];
                const busy = busyId === order.id;
                return (
                  <li
                    key={order.id}
                    className="flex flex-wrap items-center gap-x-6 gap-y-4 p-4 sm:p-6"
                  >
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-medium">{order.code}</span>
                        <OrderStatusBadge status={order.status} />
                      </div>
                      <p className="mt-1 truncate text-sm text-muted">
                        {order.customer.fullName} · {order.customer.email}
                      </p>
                      <p className="text-sm text-muted">
                        {formatDateTime(order.createdAt)} · {order.itemCount} sản phẩm ·{' '}
                        {formatVND(order.total)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {next && (
                        <Button
                          variant="secondary"
                          loading={busy}
                          disabled={busyId !== null}
                          onClick={() => void move(order, next.to)}
                        >
                          {next.label}
                        </Button>
                      )}
                      {WAREHOUSE_CANCELLABLE.includes(order.status) && (
                        <ConfirmButton
                          label="Huỷ"
                          question={`Huỷ ${order.code} và hoàn kho?`}
                          confirmLabel="Huỷ đơn"
                          loading={busy}
                          onConfirm={() => void move(order, 'CANCELLED')}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Pagination
            page={page}
            totalPages={state.data.totalPages}
            onChange={(nextPage) => setParams({ status, page: String(nextPage) })}
          />
        </>
      )}
    </>
  );
}
