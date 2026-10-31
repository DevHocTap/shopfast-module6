import { Badge } from '../../components/ui/Badge';
import { STATUS_LABEL, STATUS_TONE } from '../../lib/order-status';
import type { OrderStatus } from '../../lib/types';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
