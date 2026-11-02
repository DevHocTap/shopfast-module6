import { OrderStatus, STATUS_LABELS_VI } from '../orders/order-state-machine';

export const ORDER_CODE_PATTERN = /\bSF-[A-Z0-9]{8}\b/g;

export const UNVERIFIED_ORDER_REPLY =
  'Tôi cần tra cứu đơn hàng trước khi trả lời về trạng thái. ' +
  'Bạn cho tôi mã đơn (dạng SF-XXXXXXXX) để tôi kiểm tra nhé.';

/** Both spellings of "huỷ/hủy" are in use; compare on one. */
const normalise = (text: string) => text.toLowerCase().normalize('NFC').replace(/hủy/g, 'huỷ');

const STATUS_WORDS = [
  ...Object.values(STATUS_LABELS_VI).map(normalise),
  ...Object.values(OrderStatus).map((status) => status.toLowerCase()),
];

export interface GuardResult {
  text: string;
  /** True when the model's answer was replaced. */
  guarded: boolean;
}

/**
 * Last line of defence against invented order facts: an answer that names an order code AND
 * talks about an order status is only allowed when that code was looked up in this same turn.
 * Prompting asks for this; the guard enforces it whatever the model wrote.
 */
export function guardReply(text: string, lookedUpCodes: ReadonlySet<string>): GuardResult {
  const codes = text.match(ORDER_CODE_PATTERN) ?? [];
  const unverified = codes.filter((code) => !lookedUpCodes.has(code));
  if (unverified.length === 0) return { text, guarded: false };

  const lower = normalise(text);
  const talksAboutStatus = STATUS_WORDS.some((word) => lower.includes(word));
  return talksAboutStatus
    ? { text: UNVERIFIED_ORDER_REPLY, guarded: true }
    : { text, guarded: false };
}
