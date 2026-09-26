import type { FinancialTransaction } from "./types";

export interface LedgerEntry {
  transactionId: string;
  type: "financial_transaction";
  occurredAt: string;
  amountMinor: number;
  currency: string;
  status: string;
  correlationId?: string;
}

export async function appendLedger(entry: LedgerEntry): Promise<void> {
  // Persistence via existing Firebase RTDB abstraction if needed
  // For now: concept only; actual persistence uses existing event-store / RTDB patterns
  // Not creating a second DB.
}
