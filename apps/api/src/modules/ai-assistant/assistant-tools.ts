import { LlmToolOutcome, LlmToolSpec } from '../../infra/llm/llm.port';
import { canTransition, OrderStatus, STATUS_LABELS_VI } from '../orders/order-state-machine';
import { OrderDetail } from '../orders/orders.repository';
import { AssistantRepository } from './assistant.repository';

const ORDER_CODE = /^SF-[A-Z0-9]{8}$/;
const SKU = /^[A-Z0-9-]{3,40}$/;
/** One answer may propose at most this many actions (no mass cancellation via injection). */
export const MAX_PROPOSALS_PER_TURN = 1;

/** Read-only lookups, plus one tool that can only RECORD a proposal. No tool writes business data. */
export const ASSISTANT_TOOLS: LlmToolSpec[] = [
  {
    name: 'get_order_status',
    description:
      'Look up one ShopFast order by its code (SF- followed by 8 letters or digits). Returns status, ' +
      'items, total, payment and status history, or found=false. The only source of order facts.',
    inputSchema: {
      type: 'object',
      properties: { order_code: { type: 'string', description: 'e.g. SF-7KQ2M9XA' } },
      required: ['order_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_inventory',
    description:
      'Look up a product by SKU (e.g. SKU-00123). Returns name, price in VND, whether it is still ' +
      'sold, and the quantity in stock, or found=false.',
    inputSchema: {
      type: 'object',
      properties: { sku: { type: 'string' } },
      required: ['sku'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_action',
    description:
      'Propose cancelling the order of the customer who opened this ticket. Does NOT cancel ' +
      'anything: it records a proposal that a staff member approves or rejects. Use only when the ' +
      'customer or the staff member asked for the cancellation.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['CANCEL_ORDER'] },
        order_code: { type: 'string' },
        reason: {
          type: 'string',
          description: 'Short reason in Vietnamese, shown to the reviewer',
        },
      },
      required: ['type', 'order_code', 'reason'],
      additionalProperties: false,
    },
  },
];

export interface ToolContext {
  ticketId: string;
  customerId: string;
  staffId: string;
  /** Codes passed to get_order_status in this turn (used by the output guard). */
  lookedUpCodes: Set<string>;
  proposals: number;
}

export interface ToolDeps {
  findOrder(code: string): Promise<OrderDetail | null>;
  repository: AssistantRepository;
}

/** Model-produced input: anything that is not a string counts as empty. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ok = (value: unknown): LlmToolOutcome => ({ content: JSON.stringify(value) });
const fail = (error: string, message: string): LlmToolOutcome => ({
  content: JSON.stringify({ error, message }),
  isError: true,
});

/** Executes one tool call for the model. Inputs are validated here, never trusted. */
export async function runAssistantTool(
  deps: ToolDeps,
  context: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<LlmToolOutcome> {
  switch (name) {
    case 'get_order_status': {
      const code = text(input.order_code).trim().toUpperCase();
      if (!ORDER_CODE.test(code)) return fail('INVALID_CODE', 'Order codes look like SF-7KQ2M9XA.');
      context.lookedUpCodes.add(code);
      const order = await deps.findOrder(code);
      if (!order) return ok({ found: false, order_code: code });
      return ok({
        found: true,
        order_code: order.code,
        status: order.status,
        status_label: STATUS_LABELS_VI[order.status],
        belongs_to_ticket_customer: order.customer.id === context.customerId,
        placed_at: order.createdAt,
        last_change_at: order.updatedAt,
        total_vnd: order.total,
        paid: order.payment !== null,
        items: order.items.map((item) => ({
          name: item.productName,
          sku: item.sku,
          quantity: item.quantity,
        })),
        history: order.history.map((entry) => ({
          status: STATUS_LABELS_VI[entry.to],
          at: entry.at,
        })),
      });
    }

    case 'check_inventory': {
      const sku = text(input.sku).trim().toUpperCase();
      if (!SKU.test(sku)) return fail('INVALID_SKU', 'SKUs look like SKU-00123.');
      const product = await deps.repository.productBySku(sku);
      if (!product) return ok({ found: false, sku });
      return ok({
        found: true,
        sku: product.sku,
        name: product.name,
        price_vnd: product.price,
        on_sale: product.isActive,
        in_stock: product.quantity,
      });
    }

    case 'propose_action': {
      if (input.type !== 'CANCEL_ORDER') return fail('UNSUPPORTED', 'Only CANCEL_ORDER exists.');
      if (context.proposals >= MAX_PROPOSALS_PER_TURN) {
        return fail('TOO_MANY_PROPOSALS', 'Only one proposal per answer.');
      }
      const code = text(input.order_code).trim().toUpperCase();
      const order = ORDER_CODE.test(code) ? await deps.findOrder(code) : null;
      // Only the ticket owner's own orders: injected text cannot target someone else's order.
      if (!order || order.customer.id !== context.customerId) {
        return fail('ORDER_NOT_IN_TICKET', 'This order does not belong to the ticket customer.');
      }
      if (!canTransition(order.status, OrderStatus.CANCELLED)) {
        return fail(
          'NOT_CANCELLABLE',
          `Order is "${STATUS_LABELS_VI[order.status]}" and can no longer be cancelled.`,
        );
      }
      const reason = text(input.reason).trim().slice(0, 500) || 'Khách yêu cầu huỷ đơn';
      const proposal = await deps.repository.propose({
        ticketId: context.ticketId,
        type: 'CANCEL_ORDER',
        orderId: order.id,
        reason,
        proposedFor: context.staffId,
      });
      context.proposals += 1;
      return ok({
        proposed: true,
        action_id: proposal.id,
        already_open: !proposal.created,
        executed: false,
        note: 'Waiting for staff approval. The order has NOT been cancelled.',
      });
    }

    default:
      return fail('UNKNOWN_TOOL', `No tool named ${name}.`);
  }
}
