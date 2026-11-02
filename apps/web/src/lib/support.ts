import type { Tone } from '../components/ui/Badge';
import type { AgentActionStatus, TicketCategory, TicketStatus, ToolCall } from './types';

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  ORDER_STATUS: 'Trạng thái đơn',
  SHIPPING: 'Giao hàng',
  PAYMENT: 'Thanh toán',
  RETURN_REFUND: 'Đổi trả / hoàn tiền',
  PRODUCT_INFO: 'Thông tin sản phẩm',
  ACCOUNT: 'Tài khoản',
  OTHER: 'Khác',
  UNCLASSIFIED: 'Chưa phân loại',
};

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as TicketCategory[];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Chờ phản hồi',
  ANSWERED: 'Đã trả lời',
  CLOSED: 'Đã đóng',
};

export const TICKET_STATUS_TONE: Record<TicketStatus, Tone> = {
  OPEN: 'warning',
  ANSWERED: 'brand',
  CLOSED: 'neutral',
};

export const ACTION_STATUS_LABEL: Record<AgentActionStatus, string> = {
  PROPOSED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  EXECUTED: 'Đã thực hiện',
  FAILED: 'Không thực hiện được',
};

export const ACTION_STATUS_TONE: Record<AgentActionStatus, Tone> = {
  PROPOSED: 'warning',
  APPROVED: 'brand',
  REJECTED: 'neutral',
  EXECUTED: 'success',
  FAILED: 'danger',
};

/** What the assistant did, in words a support agent understands. */
export function describeToolCall(call: ToolCall): string {
  const value = (key: string) => (typeof call.input[key] === 'string' ? call.input[key] : '');
  switch (call.name) {
    case 'get_order_status':
      return `Tra cứu đơn ${value('order_code')}`;
    case 'check_inventory':
      return `Kiểm tra tồn kho ${value('sku')}`;
    case 'propose_action':
      return `Đề xuất huỷ đơn ${value('order_code')}`;
    default:
      return call.name;
  }
}
