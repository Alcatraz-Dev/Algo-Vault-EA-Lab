/**
 * Trade Ticket — pure helpers behind the TradingView trade confirmation UI.
 *
 * Keeping this logic framework-free makes the confirmation flow testable:
 *   • an intent is built once per ticket (stable idempotency request id)
 *   • submission blockers are computed before the confirm button is enabled
 *   • LIVE (or unreported) accounts always require an explicit acknowledgement
 *     captured immediately before execution
 *   • the confirm sheet renders only values that genuinely exist
 */
import type {
  AccountMode,
  ExecutionCapabilitySet,
  NormalizedOrderIntent,
  OrderValidationResult,
  PreparedTradeDraft,
  RiskCheckResult,
  TradingViewAccountInfo,
} from "@/types/execution";
import { newRequestId } from "./execution-adapter";

export interface TradeTicketFields {
  requestId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP";
  quantity: number;
  price?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  timeframe?: string | null;
  strategyId?: string | null;
  strategyName?: string | null;
  setupId?: string | null;
  analysisId?: string | null;
}

/** Stable idempotency id — created when the ticket is opened, reused on retry. */
export function createTicketRequestId(): string {
  return newRequestId("ticket");
}

export function buildOrderIntent(
  fields: TradeTicketFields,
  account: TradingViewAccountInfo
): NormalizedOrderIntent {
  return {
    requestId: fields.requestId,
    symbol: String(fields.symbol || "").trim().toUpperCase(),
    side: fields.side,
    orderType: fields.orderType,
    quantity: Number(fields.quantity) || 0,
    price: fields.price ?? null,
    stopLoss: fields.stopLoss ?? null,
    takeProfit: fields.takeProfit ?? null,
    accountId: account.accountId,
    broker: account.broker,
    mode: account.mode,
    strategyId: fields.strategyId ?? null,
    strategyName: fields.strategyName ?? null,
    setupId: fields.setupId ?? null,
    analysisId: fields.analysisId ?? null,
    timeframe: fields.timeframe ?? null,
  };
}

/** Pre-fill the ticket from an AI Setup Radar / Copilot prepared trade. */
export function intentFromPreparedDraft(
  draft: PreparedTradeDraft,
  account: TradingViewAccountInfo,
  requestId: string
): NormalizedOrderIntent {
  return buildOrderIntent(
    {
      requestId,
      symbol: draft.symbol,
      side: draft.side,
      orderType: draft.orderType,
      quantity: draft.quantity ?? 0,
      price: draft.price,
      stopLoss: draft.stopLoss,
      takeProfit: draft.takeProfit,
      timeframe: draft.timeframe,
      strategyId: draft.strategyId,
      strategyName: draft.strategyName,
      setupId: draft.setupId,
      analysisId: draft.analysisId,
    },
    account
  );
}

/* ── confirmation gating ────────────────────────────────────────────── */

/**
 * LIVE, or any mode no source actually reported, requires the trader to
 * acknowledge real-money risk immediately before submitting. PAPER/DEMO do
 * not (they are still gated behind the explicit confirm action).
 */
export function requiresLiveAcknowledgement(account: TradingViewAccountInfo): boolean {
  return account.mode === "LIVE" || account.mode === "UNKNOWN";
}

export function modeLabel(mode: AccountMode): string {
  switch (mode) {
    case "LIVE":
      return "LIVE";
    case "DEMO":
      return "DEMO";
    case "PAPER":
      return "PAPER";
    default:
      return "MODE NOT REPORTED";
  }
}

export interface TicketGatingInput {
  account: TradingViewAccountInfo;
  capabilities: ExecutionCapabilitySet;
  validation: OrderValidationResult;
  risk: RiskCheckResult | null;
  riskEvaluated: boolean;
  liveAcknowledged: boolean;
  submitting: boolean;
}

export interface TicketGating {
  /** True when the confirm action may be initiated at all. */
  canReview: boolean;
  /** True when the final "Review & Confirm Trade" button may fire. */
  canConfirm: boolean;
  blockers: string[];
  requiresLiveAcknowledgement: boolean;
  /** Live trades must run the Execution Risk Check before confirmation. */
  requiresRiskCheck: boolean;
}

export function evaluateTicketGating(input: TicketGatingInput): TicketGating {
  const blockers: string[] = [];
  const { account, capabilities, validation, risk } = input;

  const executionEnabled =
    account.accountState === "TRADING_ENABLED" &&
    account.tradingEnabled &&
    capabilities.gatewayExecutionSupported;

  if (!executionEnabled) {
    blockers.push(
      account.unsupportedReason ||
        "Execution is unavailable on the current connection."
    );
  }
  if (!validation.valid) {
    blockers.push(...validation.errors);
  }

  const needsLiveAck = executionEnabled && requiresLiveAcknowledgement(account);
  if (needsLiveAck && !input.liveAcknowledged) {
    blockers.push(
      account.mode === "LIVE"
        ? "Confirm that you understand this order affects a LIVE account."
        : "Account mode is not reported — acknowledge the live-risk warning to continue."
    );
  }

  const requiresRiskCheck = executionEnabled && needsLiveAck;
  if (requiresRiskCheck && !input.riskEvaluated) {
    blockers.push("Run the Execution Risk Check before confirming this trade.");
  }
  if (input.riskEvaluated && risk && risk.brokerRestrictions.includes("RISK_EXCEEDED_MAX_THRESHOLD")) {
    blockers.push("Execution Risk Check rejected this order (risk above the maximum threshold).");
  }

  if (input.submitting) {
    blockers.push("An order is currently being submitted.");
  }

  // The same underlying reason (e.g. unsupportedReason) can surface both from
  // gating and from validation — show each distinct blocker only once.
  const uniqueBlockers = blockers.filter(
    (b, index) => blockers.indexOf(b) === index
  );

  return {
    canReview: executionEnabled && validation.valid && !input.submitting,
    canConfirm: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    requiresLiveAcknowledgement: needsLiveAck,
    requiresRiskCheck,
  };
}

/* ── confirm-sheet summary (only real values) ───────────────────────── */

export interface TicketLine {
  label: string;
  value: string;
  tone?: "default" | "danger" | "success" | "muted";
}

const fmt = (v: number | null | undefined, fallback = "—"): string =>
  v === null || v === undefined || !Number.isFinite(v) ? fallback : String(v);

export function ticketSummary(
  intent: NormalizedOrderIntent,
  account: TradingViewAccountInfo
): TicketLine[] {
  const lines: TicketLine[] = [
    { label: "Symbol", value: intent.symbol || "—" },
    { label: "Side", value: intent.side, tone: intent.side === "BUY" ? "success" : "danger" },
    { label: "Order Type", value: intent.orderType },
    { label: "Quantity", value: fmt(intent.quantity) },
    {
      label: "Entry",
      value: intent.orderType === "MARKET" ? "Market" : fmt(intent.price),
    },
    { label: "Stop / Invalidation", value: fmt(intent.stopLoss), tone: intent.stopLoss ? "danger" : "muted" },
    { label: "Take Profit", value: fmt(intent.takeProfit), tone: intent.takeProfit ? "success" : "muted" },
    { label: "Account", value: account.accountIdMasked || "Unavailable" },
    { label: "Broker", value: account.broker || "Unavailable" },
    {
      label: "Mode",
      value: modeLabel(account.mode),
      tone: account.mode === "LIVE" || account.mode === "UNKNOWN" ? "danger" : "default",
    },
  ];
  if (intent.strategyName) lines.push({ label: "Strategy", value: intent.strategyName });
  if (intent.timeframe) lines.push({ label: "Timeframe", value: intent.timeframe });
  return lines;
}
