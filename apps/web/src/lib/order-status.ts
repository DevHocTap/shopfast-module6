import type { Tone } from '../components/ui/Badge';
import type { OrderStatus } from './types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  PAID: 'Đã thanh toán',
  PACKING: 'Đang đóng gói',
  SHIPPED: 'Đang giao',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã huỷ',
};

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  PENDING_PAYMENT: 'warning',
  PAID: 'brand',
  PACKING: 'brand',
  SHIPPED: 'brand',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
};

/** The normal path of an order, used to draw the progress tracker. */
export const STATUS_FLOW: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'PACKING',
  'SHIPPED',
  'DELIVERED',
];

/** The single next step a warehouse operator performs from each status. */
export const WAREHOUSE_NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  PAID: { to: 'PACKING', label: 'Bắt đầu đóng gói' },
  PACKING: { to: 'SHIPPED', label: 'Giao cho vận chuyển' },
  SHIPPED: { to: 'DELIVERED', label: 'Xác nhận đã giao' },
};

export const WAREHOUSE_CANCELLABLE: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'PACKING'];
export const CUSTOMER_CANCELLABLE: OrderStatus[] = ['PENDING_PAYMENT', 'PAID'];
