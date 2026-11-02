export enum TicketCategory {
  ORDER_STATUS = 'ORDER_STATUS',
  SHIPPING = 'SHIPPING',
  PAYMENT = 'PAYMENT',
  RETURN_REFUND = 'RETURN_REFUND',
  PRODUCT_INFO = 'PRODUCT_INFO',
  ACCOUNT = 'ACCOUNT',
  OTHER = 'OTHER',
  /** Classifier unavailable or not confident enough (< 0.6): a human sorts it. */
  UNCLASSIFIED = 'UNCLASSIFIED',
}

/** Labels the classifier may choose from (UNCLASSIFIED is decided by us, not by the model). */
export const CLASSIFIABLE: readonly TicketCategory[] = Object.values(TicketCategory).filter(
  (c) => c !== TicketCategory.UNCLASSIFIED,
);

export enum TicketStatus {
  OPEN = 'OPEN',
  ANSWERED = 'ANSWERED',
  CLOSED = 'CLOSED',
}

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
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketMessage {
  id: string;
  fromStaff: boolean;
  author: { id: string; fullName: string };
  body: string;
  createdAt: Date;
}

export interface TicketDetail extends TicketSummary {
  messages: TicketMessage[];
}
