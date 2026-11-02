import { Check, CornerDownLeft, Search, ShieldAlert, Sparkles, X } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { TextareaField } from '../../components/ui/Field';
import { Card, InlineAlert, Skeleton } from '../../components/ui/States';
import { api, ApiError, errorMessage } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { ACTION_STATUS_LABEL, ACTION_STATUS_TONE, describeToolCall } from '../../lib/support';
import { useToast } from '../../lib/toast';
import type { AgentAction, AssistantTurn, ChatResult, Conversation } from '../../lib/types';
import { useAsync } from '../../lib/use-async';

const SUGGESTIONS = ['Tóm tắt yêu cầu của khách', 'Đơn của khách đang ở đâu?', 'Soạn câu trả lời'];

/**
 * Staff-side assistant for one ticket. It looks things up and drafts replies; anything that
 * changes data appears as a proposal that the staff member approves or rejects here.
 */
export function AssistantPanel({
  ticketId,
  onUseDraft,
  onActionDone,
}: {
  ticketId: string;
  onUseDraft(text: string): void;
  /** An approved action changed the order: the ticket page re-reads what it shows. */
  onActionDone(): void;
}) {
  const toast = useToast();
  const { state, setState } = useAsync(
    () => api<Conversation>(`/assistant/tickets/${ticketId}/conversation`),
    [ticketId],
  );
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [deciding, setDeciding] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const turnCount = state.status === 'success' ? state.data.turns.length : 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [turnCount, asking]);

  if (state.status === 'loading') {
    return (
      <Card className="flex flex-col gap-4 p-6" aria-busy="true">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }
  if (state.status === 'error') {
    return (
      <Card className="p-6">
        <InlineAlert tone="danger">{errorMessage(state.error)}</InlineAlert>
      </Card>
    );
  }

  const conversation = state.data;
  const update = (patch: Partial<Conversation>) =>
    setState({ status: 'success', data: { ...conversation, ...patch } });

  async function ask(text: string, event?: FormEvent) {
    event?.preventDefault();
    const message = text.trim();
    if (!message || asking) return;
    setAsking(true);
    setError(undefined);
    const now = new Date().toISOString();
    const pendingTurn: AssistantTurn = {
      role: 'user',
      content: message,
      toolCalls: [],
      guarded: false,
      createdAt: now,
    };
    update({ turns: [...conversation.turns, pendingTurn] });
    setQuestion('');
    try {
      const result = await api<ChatResult>('/assistant/chat', {
        method: 'POST',
        body: { ticketId, message },
      });
      const answer: AssistantTurn = {
        role: 'assistant',
        content: result.reply,
        toolCalls: result.toolCalls,
        guarded: result.guarded,
        createdAt: new Date().toISOString(),
      };
      const others = conversation.actions.filter((a) => a.status !== 'PROPOSED');
      update({
        turns: [...conversation.turns, pendingTurn, answer],
        actions: [...result.actions, ...others],
      });
    } catch (failure) {
      // Give the question back so nothing typed is lost.
      update({ turns: conversation.turns });
      setQuestion(message);
      if (failure instanceof ApiError && failure.code === 'AI_UNAVAILABLE') {
        update({ available: false, turns: conversation.turns });
      }
      setError(errorMessage(failure));
    } finally {
      setAsking(false);
    }
  }

  async function decide(action: AgentAction, verdict: 'approve' | 'reject') {
    setDeciding(action.id);
    try {
      const updated = await api<AgentAction>(`/assistant/actions/${action.id}/${verdict}`, {
        method: 'POST',
      });
      update({ actions: conversation.actions.map((a) => (a.id === updated.id ? updated : a)) });
      if (updated.status === 'EXECUTED') toast.success(updated.result ?? 'Đã thực hiện.');
      else if (updated.status === 'FAILED') toast.error(updated.result ?? 'Không thực hiện được.');
      else toast.success('Đã từ chối đề xuất.');
      onActionDone();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setDeciding(null);
    }
  }

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="size-5 text-brand-700" aria-hidden />
          Trợ lý AI
        </h2>
        {!conversation.available && <Badge tone="warning">Tạm ngưng</Badge>}
      </div>

      {conversation.actions.length > 0 && (
        <section className="border-b border-border p-6" aria-label="Đề xuất của trợ lý">
          <h3 className="text-sm font-semibold">Đề xuất hành động</h3>
          <ul className="mt-4 flex flex-col gap-4">
            {conversation.actions.map((action) => (
              <li key={action.id} className="rounded-sm p-4 ring-1 ring-inset ring-border">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Huỷ đơn {action.order.code}</p>
                  <Badge tone={ACTION_STATUS_TONE[action.status]}>
                    {ACTION_STATUS_LABEL[action.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{action.reason}</p>
                {action.status === 'PROPOSED' ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      loading={deciding === action.id}
                      disabled={deciding !== null}
                      onClick={() => void decide(action, 'approve')}
                    >
                      <Check className="size-4" aria-hidden />
                      Duyệt và huỷ đơn
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={deciding !== null}
                      onClick={() => void decide(action, 'reject')}
                    >
                      <X className="size-4" aria-hidden />
                      Từ chối
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">
                    {action.reviewedBy?.fullName}
                    {action.reviewedAt && ` · ${formatDateTime(action.reviewedAt)}`}
                    {action.result && ` · ${action.result}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex max-h-[32rem] flex-col gap-4 overflow-y-auto p-6" aria-live="polite">
        {conversation.turns.length === 0 && !asking && (
          <p className="text-sm text-muted">
            {conversation.available
              ? 'Hỏi trợ lý về ticket này. Trợ lý tra cứu đơn hàng và tồn kho thật; mọi thao tác thay đổi dữ liệu đều cần bạn duyệt.'
              : 'Trợ lý AI đang tạm ngưng (chưa cấu hình khoá dịch vụ AI hoặc dịch vụ đang lỗi). Bạn vẫn xử lý ticket như bình thường.'}
          </p>
        )}
        {conversation.turns.map((turn, index) => (
          <Turn key={index} turn={turn} onUseDraft={onUseDraft} />
        ))}
        {asking && (
          <div className="flex flex-col gap-2" aria-label="Trợ lý đang trả lời">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(event) => void ask(question, event)} className="border-t border-border p-6">
        <div className="mb-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={!conversation.available || asking}
              onClick={() => void ask(suggestion)}
              className="min-h-11 rounded-sm px-3 text-sm text-muted ring-1 ring-inset ring-border transition-colors duration-150 hover:bg-canvas hover:text-ink disabled:opacity-60"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <TextareaField
          label="Câu hỏi cho trợ lý"
          rows={2}
          value={question}
          maxLength={2000}
          disabled={!conversation.available}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) void ask(question, event);
          }}
          hint="Enter để gửi, Shift + Enter để xuống dòng."
        />
        {error && (
          <div className="mt-4">
            <InlineAlert tone="danger">{error}</InlineAlert>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button
            type="submit"
            loading={asking}
            disabled={!conversation.available || !question.trim()}
          >
            Hỏi trợ lý
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Turn({ turn, onUseDraft }: { turn: AssistantTurn; onUseDraft(text: string): void }) {
  if (turn.role === 'user') {
    return (
      <div className="ml-8 self-end rounded-lg bg-brand-50 px-4 py-3">
        <p className="whitespace-pre-wrap break-words">{turn.content}</p>
      </div>
    );
  }
  return (
    <div className="mr-8 flex flex-col gap-2">
      {turn.toolCalls.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {turn.toolCalls.map((call, index) => (
            <li
              key={index}
              className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-sm ${
                call.isError ? 'bg-danger-50 text-danger-700' : 'bg-canvas text-muted'
              }`}
            >
              <Search className="size-3" aria-hidden />
              {describeToolCall(call)}
              {call.isError && ' (bị từ chối)'}
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-lg bg-canvas px-4 py-3 ring-1 ring-inset ring-border">
        {turn.guarded && (
          <p className="mb-2 flex items-center gap-1 text-sm text-warning-700">
            <ShieldAlert className="size-4" aria-hidden />
            Câu trả lời gốc nêu trạng thái đơn chưa được tra cứu nên đã bị thay thế.
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">{turn.content}</p>
      </div>
      <button
        type="button"
        onClick={() => onUseDraft(turn.content)}
        className="inline-flex min-h-11 items-center gap-1 self-start rounded-sm px-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
      >
        <CornerDownLeft className="size-4" aria-hidden />
        Dùng làm câu trả lời
      </button>
    </div>
  );
}
