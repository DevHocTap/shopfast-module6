export enum OrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  PACKING = 'PACKING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

/**
 *   PENDING_PAYMENT ─pay─▶ PAID ─▶ PACKING ─▶ SHIPPED ─▶ DELIVERED
 *         │                 │         │
 *         └─────────────────┴─────────┴──▶ CANCELLED   (stock is returned)
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.PACKING, OrderStatus.CANCELLED],
  [OrderStatus.PACKING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

/** Statuses a warehouse operator may set (payment happens through the pay endpoint). */
export const WAREHOUSE_TARGETS: readonly OrderStatus[] = [
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

/** A customer may cancel until the warehouse starts packing. */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export const STATUS_LABELS_VI: Readonly<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING_PAYMENT]: 'Chờ thanh toán',
  [OrderStatus.PAID]: 'Đã thanh toán',
  [OrderStatus.PACKING]: 'Đang đóng gói',
  [OrderStatus.SHIPPED]: 'Đang giao',
  [OrderStatus.DELIVERED]: 'Đã giao',
  [OrderStatus.CANCELLED]: 'Đã huỷ',
};
