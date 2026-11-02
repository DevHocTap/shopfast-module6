import { ArrowLeft, ChevronRight, LifeBuoy, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { InputField, SelectField, TextareaField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import {
  Card,
  EmptyState,
  ErrorState,
  InlineAlert,
  PageHeader,
  Skeleton,
} from '../../components/ui/States';
import { api, ApiError, errorMessage } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from '../../lib/support';
import type { OrderSummary, Paginated, TicketDetail, TicketSummary } from '../../lib/types';
import { useAsync } from '../../lib/use-async';
import { useToast } from '../../lib/toast';
import { TicketThread } from './TicketThread';

export function SupportPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const { state, reload } = useAsync(
    () => api<Paginated<TicketSummary>>('/tickets', { query: { page, limit: 10 } }),
    [page],
  );
  const newTicket = (
    <ButtonLink to="/support/new">
      <Plus className="size-4" aria-hidden />
      Tạo yêu cầu
    </ButtonLink>
  );

  return (
    <>
      <PageHeader
        title="Hỗ trợ"
        description="Gửi câu hỏi về đơn hàng, giao hàng, đổi trả… Nhân viên CSKH sẽ trả lời tại đây."
        actions={state.status === 'success' && state.data.items.length > 0 ? newTicket : undefined}
      />
      {state.status === 'loading' && (
        <div className="flex flex-col gap-4" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}
      {state.status === 'error' && (
        <ErrorState message={errorMessage(state.error)} onRetry={() => void reload()} />
      )}
      {state.status === 'success' && state.data.items.length === 0 && (
        <EmptyState
          icon={LifeBuoy}
          title="Bạn chưa gửi yêu cầu nào"
          description="Cần hỏi về đơn hàng hay sản phẩm? Tạo yêu cầu, nhân viên CSKH sẽ phản hồi sớm."
          action={newTicket}
        />
      )}
      {state.status === 'success' && state.data.items.length > 0 && (
        <>
          <Card>
            <ul className="divide-y divide-border">
              {state.data.items.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    to={`/support/${ticket.id}`}
                    className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 transition-colors duration-150 hover:bg-canvas sm:p-6"
                  >
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="truncate font-medium">{ticket.subject}</p>
                      <p className="mt-1 text-sm text-muted">
                        <span className="font-mono">{ticket.code}</span> · cập nhật{' '}
                        {formatDateTime(ticket.updatedAt)}
                        {ticket.order && ` · đơn ${ticket.order.code}`}
                      </p>
                    </div>
                    <Badge tone={TICKET_STATUS_TONE[ticket.status]}>
                      {TICKET_STATUS_LABEL[ticket.status]}
                    </Badge>
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

export function NewTicketPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const orders = useAsync(
    () => api<Paginated<OrderSummary>>('/orders', { query: { page: 1, limit: 20 } }),
    [],
  );
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [orderId, setOrderId] = useState(params.get('orderId') ?? '');
  const [errors, setErrors] = useState<{ subject?: string; message?: string; form?: string }>({});
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = {
      subject: subject.trim().length < 3 ? 'Tiêu đề cần ít nhất 3 ký tự.' : undefined,
      message: message.trim() ? undefined : 'Hãy mô tả vấn đề bạn gặp.',
    };
    setErrors(found);
    if (found.subject || found.message) return;
    setSending(true);
    try {
      const ticket = await api<TicketDetail>('/tickets', {
        method: 'POST',
        body: { subject, message, orderId: orderId || undefined },
      });
      toast.success(`Đã gửi yêu cầu ${ticket.code}.`);
      navigate(`/support/${ticket.id}`, { replace: true });
    } catch (failure) {
      setErrors({ form: errorMessage(failure) });
    } finally {
      setSending(false);
    }
  }

  const orderOptions = [
    { value: '', label: 'Không liên quan tới đơn cụ thể' },
    ...(orders.state.status === 'success'
      ? orders.state.data.items.map((order) => ({
          value: order.id,
          label: `${order.code} · ${formatDateTime(order.createdAt)}`,
        }))
      : []),
  ];

  return (
    <>
      <BackLink to="/support" label="Hỗ trợ" />
      <PageHeader title="Tạo yêu cầu hỗ trợ" />
      <Card className="max-w-2xl p-6">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-6" noValidate>
          <InputField
            label="Tiêu đề"
            value={subject}
            maxLength={200}
            error={errors.subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Ví dụ: Đơn hàng giao chậm"
          />
          <SelectField
            label="Đơn hàng liên quan"
            options={orderOptions}
            value={orderId}
            disabled={orders.state.status === 'loading'}
            onChange={(event) => setOrderId(event.target.value)}
          />
          <TextareaField
            label="Nội dung"
            rows={6}
            value={message}
            maxLength={4000}
            error={errors.message}
            hint="Càng chi tiết, CSKH càng hỗ trợ nhanh."
            onChange={(event) => setMessage(event.target.value)}
          />
          {errors.form && <InlineAlert tone="danger">{errors.form}</InlineAlert>}
          <div className="flex flex-wrap justify-end gap-2">
            <ButtonLink to="/support" variant="secondary">
              Huỷ
            </ButtonLink>
            <Button type="submit" loading={sending}>
              Gửi yêu cầu
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}

export function TicketPage() {
  const { id = '' } = useParams();
  const { state, setState, reload } = useAsync(() => api<TicketDetail>(`/tickets/${id}`), [id]);

  return (
    <>
      <BackLink to="/support" label="Hỗ trợ" />
      {state.status === 'loading' && (
        <div className="flex flex-col gap-6" aria-busy="true">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {state.status === 'error' &&
        (state.error instanceof ApiError && state.error.statusCode === 404 ? (
          <EmptyState
            icon={LifeBuoy}
            title="Không tìm thấy yêu cầu"
            description="Yêu cầu không tồn tại hoặc không thuộc tài khoản của bạn."
            action={<ButtonLink to="/support">Về danh sách yêu cầu</ButtonLink>}
          />
        ) : (
          <ErrorState message={errorMessage(state.error)} onRetry={() => void reload()} />
        ))}
      {state.status === 'success' && (
        <>
          <TicketHeader ticket={state.data} />
          <div className="max-w-3xl">
            <TicketThread
              ticket={state.data}
              viewerIsStaff={false}
              onChange={(updated) => setState({ status: 'success', data: updated })}
            />
          </div>
        </>
      )}
    </>
  );
}

export function TicketHeader({ ticket, extra }: { ticket: TicketDetail; extra?: string }) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 break-words text-2xl font-semibold">{ticket.subject}</h1>
        <Badge tone={TICKET_STATUS_TONE[ticket.status]}>{TICKET_STATUS_LABEL[ticket.status]}</Badge>
      </div>
      <p className="mt-2 text-muted">
        <span className="font-mono">{ticket.code}</span> · gửi lúc{' '}
        {formatDateTime(ticket.createdAt)}
        {ticket.order && (
          <>
            {' · đơn '}
            <Link to={`/orders/${ticket.order.id}`} className="font-mono hover:text-brand-700">
              {ticket.order.code}
            </Link>
          </>
        )}
        {extra && ` · ${extra}`}
      </p>
    </div>
  );
}

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
