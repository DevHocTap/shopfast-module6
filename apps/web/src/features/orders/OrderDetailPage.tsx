import { ArrowLeft, Check, FileText, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ConfirmButton } from '../../components/ui/ConfirmButton';
import { Card, EmptyState, ErrorState, InlineAlert, Skeleton } from '../../components/ui/States';
import { api, ApiError, apiText, errorMessage } from '../../lib/api-client';
import { formatDateTime, formatVND } from '../../lib/format';
import { CUSTOMER_CANCELLABLE, STATUS_FLOW, STATUS_LABEL } from '../../lib/order-status';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import type { OrderDetail } from '../../lib/types';
import { useAsync } from '../../lib/use-async';
import { OrderStatusBadge } from './OrderStatusBadge';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { user } = useAuth();
  const { state, reload, setState } = useAsync(() => api<OrderDetail>(`/orders/${id}`), [id]);
  const [action, setAction] = useState<'pay' | 'cancel' | null>(null);
  const [actionError, setActionError] = useState<string>();

  const back = (
    <Link
      to="/orders"
      className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Đơn hàng của tôi
    </Link>
  );

  if (state.status === 'loading') {
    return (
      <>
        {back}
        <div className="flex flex-col gap-6" aria-busy="true">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </>
    );
  }
  if (state.status === 'error') {
    const notFound = state.error instanceof ApiError && state.error.statusCode === 404;
    return (
      <>
        {back}
        {notFound ? (
          <EmptyState
            icon={ReceiptText}
            title="Không tìm thấy đơn hàng"
            description="Đơn hàng không tồn tại hoặc không thuộc tài khoản của bạn."
            action={<ButtonLink to="/orders">Xem đơn hàng của tôi</ButtonLink>}
          />
        ) : (
          <ErrorState message={errorMessage(state.error)} onRetry={() => void reload()} />
        )}
      </>
    );
  }

  const order = state.data;
  // Staff may open any order (read-only here); pay/cancel belong to the customer who placed it.
  const isOwner = order.customer.id === user?.id;

  async function run(kind: 'pay' | 'cancel') {
    setAction(kind);
    setActionError(undefined);
    try {
      const updated = await api<OrderDetail>(`/orders/${order.id}/${kind}`, { method: 'POST' });
      setState({ status: 'success', data: updated });
      toast.success(kind === 'pay' ? 'Thanh toán thành công.' : 'Đã huỷ đơn hàng.');
    } catch (error) {
      setActionError(errorMessage(error));
      void reload();
    } finally {
      setAction(null);
    }
  }

  return (
    <>
      {back}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{order.code}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="mt-2 text-muted">
            Đặt lúc {formatDateTime(order.createdAt)}
            {!isOwner && ` · khách ${order.customer.fullName} (${order.customer.email})`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && order.status === 'PENDING_PAYMENT' && (
            <Button
              loading={action === 'pay'}
              disabled={action !== null}
              onClick={() => void run('pay')}
            >
              Thanh toán {formatVND(order.total)}
            </Button>
          )}
          {isOwner && CUSTOMER_CANCELLABLE.includes(order.status) && (
            <ConfirmButton
              label="Huỷ đơn"
              question="Huỷ đơn này?"
              confirmLabel="Huỷ đơn"
              loading={action === 'cancel'}
              onConfirm={() => void run('cancel')}
            />
          )}
        </div>
      </div>

      {actionError && (
        <div className="mb-6">
          <InlineAlert tone="danger">{actionError}</InlineAlert>
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-8">
          <ProgressTracker order={order} />
          <Card>
            <h2 className="border-b border-border p-6 text-lg font-semibold">Sản phẩm</h2>
            <ul className="divide-y divide-border">
              {order.items.map((item) => (
                <li
                  key={item.productId}
                  className="flex flex-wrap items-center justify-between gap-2 p-6"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/products/${item.productId}`}
                      className="font-medium hover:text-brand-700"
                    >
                      {item.productName}
                    </Link>
                    <p className="mt-1 text-sm text-muted">
                      {item.sku} · {formatVND(item.unitPrice)} × {item.quantity}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatVND(item.lineTotal)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card className="p-6">
          <h2 className="text-lg font-semibold">Thanh toán</h2>
          <dl className="mt-4 flex flex-col gap-2">
            <div className="flex justify-between text-muted">
              <dt>Tạm tính</dt>
              <dd className="tabular-nums">{formatVND(order.subtotal)}</dd>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-muted">
                <dt>Giảm giá{order.voucherCode ? ` (${order.voucherCode})` : ''}</dt>
                <dd className="tabular-nums">−{formatVND(order.discount)}</dd>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-border pt-4 text-lg font-semibold">
              <dt>Tổng cộng</dt>
              <dd className="tabular-nums">{formatVND(order.total)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted">
            {order.payment
              ? `Đã thanh toán lúc ${formatDateTime(order.payment.paidAt)} (giả lập).`
              : 'Chưa thanh toán.'}
          </p>
          <InvoiceLink order={order} />
        </Card>
      </div>
    </>
  );
}

/** The invoice is produced by a background job a few seconds after the order is placed. */
function InvoiceLink({ order }: { order: OrderDetail }) {
  const toast = useToast();
  const [opening, setOpening] = useState(false);

  if (!order.invoiceNumber) {
    return (
      <p className="mt-4 text-sm text-muted">Hoá đơn đang được tạo, tải lại trang sau ít giây.</p>
    );
  }

  async function open() {
    // Open the tab inside the click (popup blockers), then fill it once the invoice arrives.
    const tab = window.open('', '_blank');
    setOpening(true);
    try {
      const html = await apiText(`/orders/${order.id}/invoice`);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      tab?.close();
      toast.error(errorMessage(error));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <p className="text-sm text-muted">
        Hoá đơn <span className="font-mono">{order.invoiceNumber}</span>
      </p>
      <Button
        variant="secondary"
        className="mt-2 w-full"
        loading={opening}
        onClick={() => void open()}
      >
        {!opening && <FileText className="size-4" aria-hidden />}
        Xem hoá đơn
      </Button>
    </div>
  );
}

function ProgressTracker({ order }: { order: OrderDetail }) {
  if (order.status === 'CANCELLED') {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold">Lịch sử trạng thái</h2>
        <ol className="mt-4 flex flex-col gap-2">
          {order.history.map((entry) => (
            <li key={entry.at + entry.to} className="flex flex-wrap justify-between gap-2 text-sm">
              <span>{STATUS_LABEL[entry.to]}</span>
              <span className="text-muted">{formatDateTime(entry.at)}</span>
            </li>
          ))}
        </ol>
      </Card>
    );
  }

  const reachedAt = new Map(order.history.map((entry) => [entry.to, entry.at]));
  const currentIndex = STATUS_FLOW.indexOf(order.status);
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Tiến trình đơn hàng</h2>
      <ol className="mt-6 grid gap-4 sm:grid-cols-5">
        {STATUS_FLOW.map((status, index) => {
          const done = index <= currentIndex;
          return (
            <li
              key={status}
              className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2"
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  done
                    ? 'bg-brand-600 text-white'
                    : 'bg-canvas text-muted ring-1 ring-inset ring-border'
                }`}
                aria-hidden
              >
                {done ? <Check className="size-4" /> : index + 1}
              </span>
              <div>
                <p
                  className={`text-sm font-medium ${index === currentIndex ? 'text-brand-700' : done ? '' : 'text-muted'}`}
                >
                  {STATUS_LABEL[status]}
                </p>
                {reachedAt.has(status) && (
                  <p className="text-sm text-muted">{formatDateTime(reachedAt.get(status)!)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
