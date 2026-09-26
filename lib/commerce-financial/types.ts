export interface Money {
  amountMinor: number;
  currency: string; // uppercase normalized: USD, EUR, etc.
}

export type TransactionType =
  | "sale"
  | "refund"
  | "fee"
  | "commission"
  | "adjustment";

export type TransactionStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "reversed";

export interface FinancialTransaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Money;
  source: {
    system: "stripe" | "firebase" | "business_event" | "manual";
    id: string;
  };
  orderId?: string;
  paymentId?: string;
  productId?: string;
  customerId?: string;
  developerId?: string;
  licenseId?: string;
  occurredAt: string;
  correlationId?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}
