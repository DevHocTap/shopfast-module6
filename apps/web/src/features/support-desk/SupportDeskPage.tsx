import { ChevronRight, Inbox, Sparkles } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { SelectField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
} from '../../lib/support';
import type { AgentAction, Paginated, TicketStatus, TicketSummary } from '../../lib/types';
import { useAsync } from '../../lib/use-async';

const STATUS_OPTIONS = [
  { value: 'OPEN', label: TICKET_STATUS_LABEL.OPEN },
  { value: 'ANSWERED', label: TICKET_STATUS_LABEL.ANSWERED },
  { value: 'CLOSED', label: TICKET_STATUS_LABEL.CLOSED },
  { value: '', label: 'Tất cả trạng thái' },
];
const CATEGORY_OPTIONS = [
  { value: '', label: 'Tất cả nhóm' },
  ...CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABEL[category] })),
];

/** Support queue, sorted into groups by the AI classifier. */
export function SupportDeskPage() {
  const [params, setParams] = useSearchParams();
  const status = params.has('status') ? (params.get('status') ?? '') : 'OPEN';
  const category = params.get('category') ?? '';
  const page = Number(params.get('page') ?? 1);
  const { state, reload } = useAsync(
    () =>
      api<Paginated<TicketSummary>>('/support/tickets', {
        query: { status: status || undefined, category: category || undefined, page, limit: 20 },
      }),
    [status, category, page],
  );
  const pending = useAsync(
    () => api<AgentAction[]>('/assistant/actions', { query: { status: 'PROPOSED' } }),
    [],
  );
  const setFilter = (key: 'status' | 'category', value: string) =>
    setParams({ status, category, [key]: value });

  return (
    <>
      <PageHeader
        title="CSKH"
        description="Ticket được trợ lý AI phân nhóm tự động; bạn có thể đổi nhóm khi cần."
      />

      {pending.state.status === 'success' && pending.state.data.length > 0 && (
        <Card className="mb-8 p-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-brand-700" aria-hidden />
            {pending.state.data.length} đề xuất của trợ lý AI đang chờ duyệt
          </h2>
          <ul className="mt-4 flex flex-col gap-2">
            {pending.state.data.slice(0, 5).map((action) => (
              <li key={action.id} className="text-sm">
                <Link
                  to={`/desk/${action.ticket.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  Huỷ đơn {action.order.code}
                </Link>{' '}
                <span className="text-muted">
                  · ticket {action.ticket.code} · {action.reason}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
        <SelectField
          label="Trạng thái"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(event) => setFilter('status', event.target.value)}
        />
        <SelectField
          label="Nhóm"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(event) => setFilter('category', event.target.value)}
        />
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
          title="Không có ticket nào khớp bộ lọc"
          description="Ticket mới của khách sẽ xuất hiện ở đây. Thử bỏ bớt bộ lọc để xem các ticket khác."
        />
      )}
      {state.status === 'success' && state.data.items.length > 0 && (
        <>
          <p className="mb-4 text-sm text-muted">
            {state.data.total.toLocaleString('vi-VN')} ticket
          </p>
          <Card>
            <ul className="divide-y divide-border">
              {state.data.items.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    to={`/desk/${ticket.id}`}
                    className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 transition-colors duration-150 hover:bg-canvas sm:p-6"
                  >
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate font-medium">{ticket.subject}</p>
                      <p className="mt-1 truncate text-sm text-muted">
                        <span className="font-mono">{ticket.code}</span> ·{' '}
                        {ticket.customer.fullName} · {formatDateTime(ticket.updatedAt)}
                      </p>
                    </div>
                    <CategoryBadge category={ticket.category} />
                    <Badge tone={TICKET_STATUS_TONE[ticket.status as TicketStatus]}>
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
            onChange={(next) => setParams({ status, category, page: String(next) })}
          />
        </>
      )}
    </>
  );
}

export function CategoryBadge({ category }: { category: TicketSummary['category'] }) {
  if (!category) return <Badge>Đang phân loại…</Badge>;
  return (
    <Badge tone={category === 'UNCLASSIFIED' ? 'warning' : 'neutral'}>
      {CATEGORY_LABEL[category]}
    </Badge>
  );
}
