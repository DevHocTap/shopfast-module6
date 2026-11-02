import { LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { api, ApiError, errorMessage } from '../../lib/api-client';
import { CATEGORIES, CATEGORY_LABEL } from '../../lib/support';
import { useToast } from '../../lib/toast';
import type { TicketCategory, TicketDetail } from '../../lib/types';
import { useAsync } from '../../lib/use-async';
import { BackLink, TicketHeader } from '../support/SupportPages';
import { TicketThread } from '../support/TicketThread';
import { AssistantPanel } from './AssistantPanel';

export function DeskTicketPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { state, setState, reload } = useAsync(() => api<TicketDetail>(`/tickets/${id}`), [id]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (state.status === 'loading') {
    return (
      <>
        <BackLink to="/desk" label="CSKH" />
        <div className="flex flex-col gap-6" aria-busy="true">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        <BackLink to="/desk" label="CSKH" />
        {state.error instanceof ApiError && state.error.statusCode === 404 ? (
          <EmptyState
            icon={LifeBuoy}
            title="Không tìm thấy ticket"
            description="Ticket không tồn tại hoặc đã bị xoá."
            action={<ButtonLink to="/desk">Về hàng đợi CSKH</ButtonLink>}
          />
        ) : (
          <ErrorState message={errorMessage(state.error)} onRetry={() => void reload()} />
        )}
      </>
    );
  }

  const ticket = state.data;
  const setTicket = (updated: TicketDetail) => setState({ status: 'success', data: updated });

  async function patch(body: { status?: 'CLOSED' | 'OPEN'; category?: TicketCategory }) {
    setSaving(true);
    try {
      setTicket(
        await api<TicketDetail>(`/support/tickets/${ticket.id}`, { method: 'PATCH', body }),
      );
      toast.success('Đã cập nhật ticket.');
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <BackLink to="/desk" label="CSKH" />
      <TicketHeader
        ticket={ticket}
        extra={`khách ${ticket.customer.fullName} (${ticket.customer.email})`}
      />
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_420px]">
        <div className="flex min-w-0 flex-col gap-8">
          <Card className="flex flex-wrap items-end gap-4 p-6">
            <div className="min-w-48 flex-1">
              <SelectField
                label="Nhóm"
                value={ticket.category ?? ''}
                disabled={saving}
                options={[
                  ...(ticket.category ? [] : [{ value: '', label: 'Đang phân loại…' }]),
                  ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
                ]}
                onChange={(event) => void patch({ category: event.target.value as TicketCategory })}
              />
            </div>
            {/* Where the current group came from: the AI (with its confidence) or a person. */}
            <p className="flex min-h-11 items-center text-sm text-muted">
              {ticket.category === null
                ? 'Trợ lý AI đang phân loại…'
                : ticket.category === 'UNCLASSIFIED'
                  ? 'AI chưa đủ chắc chắn, hãy chọn nhóm.'
                  : ticket.categoryConfidence === 1
                    ? 'Nhóm do nhân viên chọn.'
                    : `AI phân loại, độ tin cậy ${Math.round((ticket.categoryConfidence ?? 0) * 100)}%`}
            </p>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => void patch({ status: ticket.status === 'CLOSED' ? 'OPEN' : 'CLOSED' })}
            >
              {ticket.status === 'CLOSED' ? 'Mở lại ticket' : 'Đóng ticket'}
            </Button>
          </Card>
          <TicketThread
            ticket={ticket}
            viewerIsStaff
            onChange={setTicket}
            draft={draft}
            onDraftChange={setDraft}
          />
        </div>
        <AssistantPanel
          ticketId={ticket.id}
          onUseDraft={(text) => {
            setDraft(text);
            toast.success('Đã chép vào ô trả lời khách, bạn kiểm tra rồi bấm Gửi.');
          }}
          onActionDone={() => void reload()}
        />
      </div>
    </>
  );
}
