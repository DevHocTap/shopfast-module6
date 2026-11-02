import { FormEvent, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { TextareaField } from '../../components/ui/Field';
import { Card, InlineAlert } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import type { TicketDetail } from '../../lib/types';

/** Conversation between the customer and support, plus the reply box (customer and staff). */
export function TicketThread({
  ticket,
  viewerIsStaff,
  onChange,
  draft,
  onDraftChange,
}: {
  ticket: TicketDetail;
  viewerIsStaff: boolean;
  onChange(updated: TicketDetail): void;
  /** Controlled draft, so the AI assistant can fill the reply box. */
  draft?: string;
  onDraftChange?(value: string): void;
}) {
  const [ownDraft, setOwnDraft] = useState('');
  const body = draft ?? ownDraft;
  const setBody = onDraftChange ?? setOwnDraft;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const closed = ticket.status === 'CLOSED';

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError(undefined);
    try {
      onChange(
        await api<TicketDetail>(`/tickets/${ticket.id}/messages`, {
          method: 'POST',
          body: { body },
        }),
      );
      setBody('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <h2 className="border-b border-border p-6 text-lg font-semibold">Trao đổi</h2>
      <ol className="flex flex-col gap-4 p-6">
        {ticket.messages.map((message) => {
          // The viewer's own side sits on the right, like any chat.
          const mine = message.fromStaff === viewerIsStaff;
          return (
            <li key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-lg px-4 py-3 ${
                  mine ? 'bg-brand-50' : 'bg-canvas ring-1 ring-inset ring-border'
                }`}
              >
                <p className="text-sm text-muted">
                  <span className="font-medium text-ink">
                    {message.fromStaff
                      ? `${message.author.fullName} · CSKH`
                      : message.author.fullName}
                  </span>{' '}
                  · {formatDateTime(message.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="border-t border-border p-6">
        {closed ? (
          <p className="text-sm text-muted">
            Yêu cầu này đã đóng.
            {!viewerIsStaff && ' Nếu cần hỗ trợ thêm, bạn hãy tạo yêu cầu mới.'}
          </p>
        ) : (
          <form onSubmit={(event) => void send(event)} className="flex flex-col gap-4">
            <TextareaField
              label={viewerIsStaff ? 'Trả lời khách' : 'Gửi thêm thông tin'}
              value={body}
              maxLength={4000}
              onChange={(event) => setBody(event.target.value)}
              placeholder={viewerIsStaff ? 'Nội dung gửi tới khách…' : 'Nhập nội dung…'}
            />
            {error && <InlineAlert tone="danger">{error}</InlineAlert>}
            <div className="flex justify-end">
              <Button type="submit" loading={sending} disabled={!body.trim()}>
                Gửi
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
