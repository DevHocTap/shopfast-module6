import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { AppError } from '../../common/errors/app-error';
import { LlmPort, LlmTurn, LlmUnavailableError } from '../../infra/llm/llm.port';
import { OrdersService } from '../orders/orders.service';
import { SupportRepository } from '../support/support.repository';
import { SupportErrors } from '../support/support.errors';
import { TicketDetail } from '../support/support.types';
import { runAssistantTool, ASSISTANT_TOOLS, ToolContext } from './assistant-tools';
import { asData, ASSISTANT_SYSTEM_PROMPT } from './assistant.prompts';
import { AssistantRepository } from './assistant.repository';
import { AgentActionStatus, ChatResult, Conversation } from './assistant.types';
import { guardReply } from './output-guard';

/** Model ↔ tool round trips allowed for one answer (cost and latency ceiling). */
export const MAX_TOOL_ROUNDS = 5;
/** Earlier exchanges replayed to the model (each exchange is two turns). */
const HISTORY_TURNS = 12;

const REFUSED_REPLY =
  'Tôi không thể hỗ trợ yêu cầu này. Tôi chỉ giúp được các việc chăm sóc khách hàng của ShopFast.';
const UNFINISHED_REPLY =
  'Tôi chưa hoàn tất được việc tra cứu cho câu hỏi này. Bạn thử hỏi cụ thể hơn (kèm mã đơn hoặc SKU) nhé.';

export const AssistantErrors = {
  unavailable: () =>
    new AppError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AI_UNAVAILABLE',
      'Trợ lý AI đang tạm ngưng. Bạn vẫn có thể xử lý ticket như bình thường.',
    ),
};

/**
 * Support assistant (F01). It reads (orders, stock) and may PROPOSE a cancellation; it never
 * writes business data. Every turn is stored in assistant_messages for review and evaluation.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly llm: LlmPort,
    private readonly tickets: SupportRepository,
    private readonly orders: OrdersService,
    private readonly repository: AssistantRepository,
  ) {}

  async conversation(staff: AuthUser, ticketId: string): Promise<Conversation> {
    if (!(await this.tickets.detail(ticketId))) throw SupportErrors.notFound();
    const [turns, actions] = await Promise.all([
      this.repository.conversation(ticketId, staff.id),
      this.repository.actions({ ticketId }),
    ]);
    return { available: this.llm.available, turns, actions };
  }

  async chat(staff: AuthUser, ticketId: string, question: string): Promise<ChatResult> {
    const ticket = await this.tickets.detail(ticketId);
    if (!ticket) throw SupportErrors.notFound();
    if (!this.llm.available) throw AssistantErrors.unavailable();

    const history = await this.repository.conversation(ticketId, staff.id, HISTORY_TURNS);
    const turns: LlmTurn[] = [
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      {
        role: 'user',
        content: `${ticketContext(ticket)}\n\nCâu hỏi của nhân viên CSKH: ${question}`,
      },
    ];
    const context: ToolContext = {
      ticketId,
      customerId: ticket.customer.id,
      staffId: staff.id,
      lookedUpCodes: new Set(),
      proposals: 0,
    };

    let result;
    try {
      result = await this.llm.runAgent({
        system: ASSISTANT_SYSTEM_PROMPT,
        turns,
        tools: ASSISTANT_TOOLS,
        maxToolRounds: MAX_TOOL_ROUNDS,
        runTool: (name, input) =>
          runAssistantTool(
            { findOrder: (code) => this.orders.findByCode(code), repository: this.repository },
            context,
            name,
            input,
          ),
      });
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        this.logger.warn(`Assistant unavailable: ${error.message}`);
        throw AssistantErrors.unavailable();
      }
      throw error;
    }

    const draft =
      result.stopReason === 'refusal'
        ? REFUSED_REPLY
        : result.text || (result.stopReason === 'max_rounds' ? UNFINISHED_REPLY : REFUSED_REPLY);
    const { text: reply, guarded } = guardReply(draft, context.lookedUpCodes);
    const toolCalls = result.toolCalls.map(({ name, input, isError }) => ({
      name,
      input,
      isError,
    }));

    await this.repository.saveTurn({
      ticketId,
      staffId: staff.id,
      question,
      answer: reply,
      toolCalls,
      guarded,
    });
    const actions = await this.repository.actions({
      ticketId,
      status: AgentActionStatus.PROPOSED,
    });
    return { reply, guarded, toolCalls, actions };
  }
}

/** The ticket as marked, neutralised data: the model reads it but must not obey it. */
function ticketContext(ticket: TicketDetail): string {
  const lines = ticket.messages.map(
    (m) => `[${m.fromStaff ? 'Nhân viên' : 'Khách'}] ${asData(m.body)}`,
  );
  return [
    '<ticket_data>',
    `Mã ticket: ${ticket.code}`,
    `Tiêu đề: ${asData(ticket.subject)}`,
    `Đơn hàng đính kèm: ${ticket.order?.code ?? 'không có'}`,
    'Hội thoại:',
    ...lines,
    '</ticket_data>',
  ].join('\n');
}
