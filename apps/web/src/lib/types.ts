/** Response shapes of the ShopFast API (apps/api). */

export type Role = 'CUSTOMER' | 'SUPPORT' | 'WAREHOUSE' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: string;
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface Named {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  inStock: boolean;
  version: number;
  category: Named;
  brand: Named;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  unitPrice: number;
  quantity: number;
  isActive: boolean;
  stock: number;
  lineTotal: number;
  available: boolean;
}

export interface Cart {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  hasUnavailableItems: boolean;
}

export type OrderStatus =
  'PENDING_PAYMENT' | 'PAID' | 'PACKING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export interface OrderSummary {
  id: string;
  code: string;
  status: OrderStatus;
  total: number;
  itemCount: number;
  version: number;
  createdAt: string;
  customer: { id: string; email: string; fullName: string };
}

export interface OrderDetail extends OrderSummary {
  subtotal: number;
  discount: number;
  voucherCode: string | null;
  updatedAt: string;
  items: {
    productId: string;
    productName: string;
    sku: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  history: { from: OrderStatus | null; to: OrderStatus; at: string }[];
  payment: { amount: number; method: string; paidAt: string } | null;
  /** Set once the background invoice job has run. */
  invoiceNumber: string | null;
}

export interface StockLevel {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  version: number;
  updatedAt: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  bypasses: number;
  hitRatio: number;
  redis: 'closed' | 'open' | 'half-open';
}

export type QueueName =
  'email' | 'invoice' | 'inventory-sync' | 'payment-reminder' | 'report' | 'ai';

export interface QueueCounts {
  name: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export interface QueueOverview {
  queues: QueueCounts[];
  pendingOutboxEvents: number;
}

export interface FailedJob {
  id: string;
  queue: string;
  jobName: string;
  jobId: string | null;
  payload: unknown;
  reason: string;
  attemptsMade: number;
  failedAt: string;
  retriedAt: string | null;
}

export interface DailyRevenue {
  date: string;
  orderCount: number;
  revenue: number;
}

/* ---------- Support & AI assistant (F01) ---------- */

export type TicketCategory =
  | 'ORDER_STATUS'
  | 'SHIPPING'
  | 'PAYMENT'
  | 'RETURN_REFUND'
  | 'PRODUCT_INFO'
  | 'ACCOUNT'
  | 'OTHER'
  | 'UNCLASSIFIED';

export type TicketStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';

export interface TicketSummary {
  id: string;
  code: string;
  subject: string;
  status: TicketStatus;
  /** null until the background classifier has run. */
  category: TicketCategory | null;
  categoryConfidence: number | null;
  order: { id: string; code: string } | null;
  customer: { id: string; email: string; fullName: string };
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  fromStaff: boolean;
  author: { id: string; fullName: string };
  body: string;
  createdAt: string;
}

export interface TicketDetail extends TicketSummary {
  messages: TicketMessage[];
}

export type AgentActionStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';

export interface AgentAction {
  id: string;
  type: 'CANCEL_ORDER';
  status: AgentActionStatus;
  reason: string;
  ticket: { id: string; code: string };
  order: { id: string; code: string };
  reviewedBy: { id: string; fullName: string } | null;
  reviewedAt: string | null;
  result: string | null;
  createdAt: string;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCall[];
  guarded: boolean;
  createdAt: string;
}

export interface ChatResult {
  reply: string;
  guarded: boolean;
  toolCalls: ToolCall[];
  actions: AgentAction[];
}

export interface Conversation {
  available: boolean;
  turns: AssistantTurn[];
  actions: AgentAction[];
}
