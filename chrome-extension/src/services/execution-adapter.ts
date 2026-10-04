/**
 * TradingViewExecutionAdapter — the Execution Bridge core.
 *
 * CAPABILITY TRUTH (verified against the installed integration):
 *   • The official TradingView MCP client in
 *     `lib/market-intelligence/providers/tradingview` is READ-ONLY
 *     (`READ_TOOLS_ONLY = true`). It exposes quotes, OHLCV, technicals,
 *     screeners, news, fundamentals, calendars, watchlists and alerts — and
 *     NO account, broker, order, position or execution tool.
 *   • Real execution exists through the AlgoVault MT5 Gateway
 *     (`POST /api/trading/orders` → gateway EA → `GET /api/trading/orders`
 *     execution reports), which is server-entitled and idempotent.
 *
 * SAFETY INVARIANTS ENFORCED HERE (never simulated, never silent):
 *   1. No order leaves this adapter without an explicit user confirmation.
 *   2. LIVE (or unreported) account modes additionally require a live
 *      acknowledgement captured immediately before submission.
 *   3. A fill is only reported after the gateway confirms it; a timeout or
 *      transport failure yields `UNKNOWN` + the mandated safety message and
 *      the request id is marked *uncertain* so it can never be auto-retried.
 *   4. Request ids are idempotent and persisted, so double-clicks, React
 *      re-renders, extension reloads and duplicated events cannot double
 *      submit.
 *   5. Risk math never invents a price, balance or exposure — if a real
 *      reference price is missing the result is "not calculable".
 */
import type {
  ExecutionCapabilitySet,
  ExecutionLifecycleStatus,
  ExecutionResult,
  ExecutionSpecification,
  ExecutionStatusEvent,
  NormalizedOrderIntent,
  OrderValidationResult,
  RiskCheckResult,
  TradeReceipt,
  TradingViewAccountInfo,
  ExecutionAuditRecord,
  JournalSyncPayload,
} from "@/types/execution";
import {
  EXECUTION_UNCONFIRMED_MESSAGE,
  RISK_NOT_CALCULABLE_MESSAGE,
} from "@/types/execution";
import {
  ApiHttpError,
  assertExecutionEntitlement,
  mapGatewayOrderStatus,
  postExecutionAudit,
  postJournalSync,
  submitGatewayOrder,
  type GatewayOrderCommand,
} from "@/api/execution";
import { getOrderStatus, type OrderStatus } from "@/api/algovault";

/* ── typed failure modes (definitive vs. uncertain) ─────────────────── */

/** The server definitively refused the request — the order was NOT accepted. */
export class OrderNotAcceptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderNotAcceptedError";
  }
}

/** The outcome cannot be determined (5xx / network) — never auto-retry. */
export class SubmissionUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionUncertainError";
  }
}

/* ── injectable transport ───────────────────────────────────────────── */

export interface ExecutionTransport {
  submitOrder(command: GatewayOrderCommand): Promise<{ duplicate?: boolean }>;
  getOrderStatus(clientOrderId: string): Promise<OrderStatus | null>;
  postAudit(record: ExecutionAuditRecord): Promise<void>;
  postJournal(payload: JournalSyncPayload): Promise<{ entryId: string }>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const defaultTransport: ExecutionTransport = {
  submitOrder: async (command) => {
    try {
      return await submitGatewayOrder(command);
    } catch (err) {
      if (err instanceof ApiHttpError) {
        // 4xx = the server refused it, so the order was definitively NOT
        // accepted. 5xx / network = outcome unknown — never auto-retried.
        if (err.status >= 400 && err.status < 500) throw new OrderNotAcceptedError(err.message);
        throw new SubmissionUncertainError(err.message);
      }
      throw new SubmissionUncertainError(err instanceof Error ? err.message : "network_error");
    }
  },
  getOrderStatus: (id) => getOrderStatus(id),
  postAudit: async (record) => {
    try {
      await postExecutionAudit(record);
    } catch {
      // Audit delivery must never block or fail the execution flow.
    }
  },
  postJournal: async (payload) => {
    const res = await postJournalSync(payload);
    return { entryId: res.entryId };
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface AdapterOptions {
  transport?: ExecutionTransport;
  checkEntitlement?: () => Promise<void>;
  /** Max time to wait for a real gateway execution report. */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Max risk (% of balance) the guard will accept. */
  maxRiskPercent?: number;
}

/* ── idempotency store (survives re-renders + extension reloads) ────── */

export type RequestIdState = "accepted" | "uncertain";

interface IdempotencyRecord {
  state: RequestIdState;
  at: number;
}

const IDEMPOTENCY_STORAGE_KEY = "executionRequestIdLedger";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX = 300;

const requestLedger = new Map<string, IdempotencyRecord>();
let ledgerHydrated = false;

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

async function hydrateLedger(): Promise<void> {
  if (ledgerHydrated) return;
  ledgerHydrated = true;
  if (!hasChromeStorage()) return;
  try {
    const stored = await new Promise<Record<string, IdempotencyRecord> | null>((resolve) => {
      chrome.storage.local.get(IDEMPOTENCY_STORAGE_KEY, (result) => {
        resolve((result[IDEMPOTENCY_STORAGE_KEY] as Record<string, IdempotencyRecord>) ?? null);
      });
    });
    if (!stored) return;
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    for (const [id, rec] of Object.entries(stored)) {
      if (rec && typeof rec.at === "number" && rec.at > cutoff) requestLedger.set(id, rec);
    }
  } catch {
    // Storage unavailable — the in-memory ledger still protects this session.
  }
}

async function persistLedger(): Promise<void> {
  if (!hasChromeStorage()) return;
  try {
    const entries = [...requestLedger.entries()].slice(-IDEMPOTENCY_MAX);
    await new Promise<void>((resolve) => {
      chrome.storage.local.set(
        { [IDEMPOTENCY_STORAGE_KEY]: Object.fromEntries(entries) },
        () => resolve()
      );
    });
  } catch {
    /* best effort */
  }
}

async function recordRequestId(requestId: string, state: RequestIdState, at = Date.now()): Promise<void> {
  await hydrateLedger();
  requestLedger.set(requestId, { state, at });
  await persistLedger();
}

function lookupRequestId(requestId: string): IdempotencyRecord | null {
  const rec = requestLedger.get(requestId);
  if (!rec) return null;
  if (Date.now() - rec.at > IDEMPOTENCY_TTL_MS) {
    requestLedger.delete(requestId);
    return null;
  }
  return rec;
}

/**
 * Test hook — clears the idempotency ledger.
 * `clearPersisted: false` keeps the stored copy, which lets tests simulate an
 * extension reload (memory wiped, ledger rehydrated from storage).
 */
export async function resetExecutionIdempotency(
  options: { clearPersisted?: boolean } = {}
): Promise<void> {
  const clearPersisted = options.clearPersisted ?? true;
  requestLedger.clear();
  ledgerHydrated = false;
  if (clearPersisted && hasChromeStorage()) {
    try {
      await new Promise<void>((resolve) => {
        chrome.storage.local.remove(IDEMPOTENCY_STORAGE_KEY, () => resolve());
      });
    } catch {
      /* ignore */
    }
  }
}

const inflightRequestIds = new Set<string>();

/** Unique idempotency key for one prepared ticket. */
export function newRequestId(prefix = "req"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/* ── action mapping (normalized intent → real gateway action) ───────── */

export function gatewayActionFor(intent: NormalizedOrderIntent): GatewayOrderCommand["action"] {
  const side = intent.side === "SELL" ? "SELL" : "BUY";
  if (intent.orderType === "LIMIT") return side === "SELL" ? "SELL_LIMIT" : "BUY_LIMIT";
  if (intent.orderType === "STOP") return side === "SELL" ? "SELL_STOP" : "BUY_STOP";
  return side;
}

/* ── adapter ────────────────────────────────────────────────────────── */

export class TradingViewExecutionAdapter {
  private readonly transport: ExecutionTransport;
  private readonly checkEntitlement: () => Promise<void>;
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxRiskPercent: number;

  constructor(options: AdapterOptions = {}) {
    this.transport = options.transport ?? defaultTransport;
    this.checkEntitlement = options.checkEntitlement ?? (() => assertExecutionEntitlement());
    this.pollTimeoutMs = options.pollTimeoutMs ?? 90_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_500;
    this.maxRiskPercent = options.maxRiskPercent ?? 10;
  }

  /**
   * Live capability detection. TradingView MCP execution is always false —
   * the installed MCP toolset is read-only — while gateway capabilities
   * reflect the actually connected, entitled MT5 gateway.
   */
  getCapabilities(account?: TradingViewAccountInfo | null): ExecutionCapabilitySet {
    const gatewayConnected = Boolean(
      account && account.accountState === "TRADING_ENABLED" && account.accountId
    );
    const limitations = [
      "TradingView MCP exposes read-only market data (quotes, technicals, news, alerts) — no account, order, position or execution tool exists.",
      "TradingView paper trading cannot be targeted programmatically; account mode is only reported when a source actually provides it.",
    ];
    if (!gatewayConnected) {
      limitations.push(
        "No execution gateway is connected — orders cannot be submitted. The ticket stays in preparation/handoff mode."
      );
    }
    return {
      tradingViewMcpExecutionSupported: false,
      tradingViewMcpAccountSupported: false,
      gatewayExecutionSupported: gatewayConnected,
      gatewayPositionsSupported: gatewayConnected,
      gatewayOrderManagementSupported: gatewayConnected,
      supportedOrderTypes: gatewayConnected ? ["MARKET", "LIMIT", "STOP"] : [],
      supportedSides: ["BUY", "SELL"],
      specification: {
        minQuantity: null, // the gateway does not report broker min-lot — never guessed
        quantityStep: null,
        pricePrecision: null,
      },
      limitations,
      detectedAt: this.transport.now(),
    };
  }

  /* ── order validation (§8) ────────────────────────────────────────── */

  validateOrder(
    intent: NormalizedOrderIntent,
    account?: TradingViewAccountInfo | null,
    capabilities?: ExecutionCapabilitySet
  ): OrderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const caps = capabilities ?? this.getCapabilities(account ?? null);
    const spec: ExecutionSpecification = caps.specification;

    if (!intent.symbol || intent.symbol.trim() === "") {
      errors.push("Symbol is required.");
    }
    if (intent.side !== "BUY" && intent.side !== "SELL") {
      errors.push("Side must be BUY or SELL.");
    }
    if (!["MARKET", "LIMIT", "STOP"].includes(intent.orderType)) {
      errors.push("Unsupported order type.");
    } else if (!caps.supportedOrderTypes.includes(intent.orderType)) {
      errors.push(
        `${intent.orderType} orders are not supported by the connected execution venue.`
      );
    }

    const qty = Number(intent.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push("Quantity must be a positive number.");
    } else {
      if (spec.minQuantity !== null && qty < spec.minQuantity) {
        errors.push(`Quantity below the venue minimum of ${spec.minQuantity}.`);
      }
      if (spec.quantityStep !== null) {
        const steps = qty / spec.quantityStep;
        if (Math.abs(steps - Math.round(steps)) > 1e-9) {
          errors.push(`Quantity must align to a step of ${spec.quantityStep}.`);
        }
      }
    }

    if ((intent.orderType === "LIMIT" || intent.orderType === "STOP") &&
        (intent.price === null || intent.price === undefined || !Number.isFinite(Number(intent.price)) || Number(intent.price) <= 0)) {
      errors.push(`Entry price is required for ${intent.orderType} orders.`);
    }
    if (
      spec.pricePrecision !== null &&
      intent.price !== null &&
      intent.price !== undefined &&
      Number.isFinite(Number(intent.price))
    ) {
      const decimals = String(intent.price).split(".")[1];
      if (decimals && decimals.length > spec.pricePrecision) {
        errors.push(`Entry price exceeds the venue precision of ${spec.pricePrecision} decimals.`);
      }
    }

    const entryRef =
      intent.price !== null && intent.price !== undefined && Number.isFinite(Number(intent.price))
        ? Number(intent.price)
        : null;

    if (entryRef !== null && intent.stopLoss) {
      if (intent.side === "BUY" && intent.stopLoss >= entryRef) {
        errors.push("Stop Loss must be below Entry Price for BUY orders.");
      }
      if (intent.side === "SELL" && intent.stopLoss <= entryRef) {
        errors.push("Stop Loss must be above Entry Price for SELL orders.");
      }
    }
    if (entryRef !== null && intent.takeProfit) {
      if (intent.side === "BUY" && intent.takeProfit <= entryRef) {
        errors.push("Take Profit must be above Entry Price for BUY orders.");
      }
      if (intent.side === "SELL" && intent.takeProfit >= entryRef) {
        errors.push("Take Profit must be below Entry Price for SELL orders.");
      }
    }

    // Account state / permissions (§8: block and explain when unavailable).
    if (account) {
      if (account.accountState === "EXECUTION_UNAVAILABLE" ||
          account.accountState === "NOT_CONNECTED" ||
          account.accountState === "READ_ONLY") {
        errors.push(
          account.unsupportedReason ||
            "Execution is unavailable — no entitled execution venue is connected."
        );
      }
      if (account.accountState === "AUTHENTICATION_REQUIRED") {
        errors.push("Reconnect TradingView before submitting an order.");
      }
      if (account.accountState === "TRADING_ENABLED" && !account.accountId) {
        errors.push("No execution account reference is available for this session.");
      }
      if (account.accountState === "TRADING_ENABLED" && !caps.gatewayExecutionSupported) {
        errors.push("The execution gateway did not report order support for this session.");
      }
    }

    if (!intent.stopLoss) {
      warnings.push("No Stop Loss specified. Trading without a Stop Loss increases downside risk.");
    }
    if (!intent.takeProfit) {
      warnings.push("No Take Profit specified.");
    }
    if (account && account.mode === "UNKNOWN") {
      warnings.push(
        "Account mode (paper/live) was not reported by any source and will be treated as live."
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      blockedReason: errors.length > 0 ? errors.join(" ") : null,
    };
  }

  /* ── risk guard (§9) ──────────────────────────────────────────────── */

  computeRiskCheck(
    intent: NormalizedOrderIntent,
    account: TradingViewAccountInfo,
    marketPrice?: number | null
  ): RiskCheckResult {
    const validation = this.validateOrder(intent, account);
    const missingRiskData: string[] = [];

    const intentPrice =
      intent.price !== null && intent.price !== undefined && Number.isFinite(Number(intent.price))
        ? Number(intent.price)
        : null;
    const market =
      marketPrice !== null && marketPrice !== undefined && Number.isFinite(Number(marketPrice))
        ? Number(marketPrice)
        : null;

    const referencePrice = intentPrice ?? market;
    const referencePriceSource: RiskCheckResult["referencePriceSource"] =
      intentPrice !== null ? "intent" : market !== null ? "market" : "none";

    if (referencePrice === null) {
      missingRiskData.push("Reference market price");
    }
    if (!intent.stopLoss) {
      missingRiskData.push("Stop Loss (SL)");
    }
    if (account.balance === null || account.balance === undefined || account.balance <= 0) {
      missingRiskData.push("Account balance");
    }

    const base: RiskCheckResult = {
      accountMode: account.mode,
      orderSize: Number(intent.quantity) || 0,
      referencePrice,
      referencePriceSource,
      estimatedExposure: null,
      stopDistance: null,
      riskAmount: null,
      riskPercentage: null,
      potentialRiskReward: null,
      missingRiskData,
      riskCalculable: false,
      brokerRestrictions: [],
      notes: null,
    };

    if (referencePrice === null) {
      return {
        ...base,
        notes: RISK_NOT_CALCULABLE_MESSAGE,
      };
    }

    const qty = Number(intent.quantity) || 0;
    const estimatedExposure = qty * referencePrice;
    let stopDistance: number | null = null;
    let riskAmount: number | null = null;
    let riskPercentage: number | null = null;
    let potentialRiskReward: number | null = null;
    const restrictions: string[] = [];
    const notes: string[] = [];

    if (intent.stopLoss && referencePrice > 0) {
      stopDistance = Math.abs(referencePrice - Number(intent.stopLoss));
      riskAmount = qty * stopDistance;
      if (intent.takeProfit && stopDistance > 0) {
        const reward = Math.abs(Number(intent.takeProfit) - referencePrice);
        potentialRiskReward = reward / stopDistance;
        if (potentialRiskReward < 1) {
          notes.push(`Low Risk/Reward Ratio: 1:${potentialRiskReward.toFixed(2)}.`);
        }
      }
      if (account.balance && account.balance > 0) {
        riskPercentage = (riskAmount / account.balance) * 100;
        if (riskPercentage > 5) {
          notes.push(`High risk: this trade risks ${riskPercentage.toFixed(2)}% of account balance.`);
        }
      }
    }

    const exceedsMax = riskPercentage !== null && riskPercentage > this.maxRiskPercent;
    if (exceedsMax) {
      restrictions.push("RISK_EXCEEDED_MAX_THRESHOLD");
      notes.push(`Risk exceeds the ${this.maxRiskPercent}% maximum threshold.`);
    }

    const riskCalculable = riskAmount !== null && (intent.stopLoss ?? null) !== null;
    if (!riskCalculable && intent.stopLoss === null) {
      notes.push(RISK_NOT_CALCULABLE_MESSAGE);
    }
    if (riskAmount !== null && riskPercentage === null) {
      notes.push("Risk percentage unavailable — account balance not reported.");
    }

    return {
      ...base,
      estimatedExposure,
      stopDistance,
      riskAmount,
      riskPercentage,
      potentialRiskReward,
      riskCalculable,
      brokerRestrictions: restrictions,
      notes: notes.length > 0 ? notes.join(" ") : validation.valid ? "Risk evaluation passed." : "Validation errors detected.",
    };
  }

  /* ── execution (§4, §7, §12, §24, §25) ────────────────────────────── */

  private timelineEvent(
    timeline: ExecutionStatusEvent[],
    status: ExecutionLifecycleStatus,
    detail?: string | null
  ): void {
    const last = timeline[timeline.length - 1];
    if (last && last.status === status) {
      if (detail) last.detail = detail;
      return;
    }
    timeline.push({ status, at: this.transport.now(), detail: detail ?? null });
  }

  private buildResult(params: {
    requestId: string;
    status: ExecutionLifecycleStatus;
    account: TradingViewAccountInfo;
    timeline: ExecutionStatusEvent[];
    error?: string | null;
    orderId?: string | null;
    executionPrice?: number | null;
    filledQuantity?: number | null;
    brokerTicket?: string | null;
    uncertain?: boolean;
    confirmed?: boolean;
    rawStatusText?: string | null;
    receipt?: TradeReceipt | null;
  }): ExecutionResult {
    return {
      requestId: params.requestId,
      status: params.status,
      orderId: params.orderId ?? null,
      executionPrice: params.executionPrice ?? null,
      filledQuantity: params.filledQuantity ?? null,
      timestamp: this.transport.now(),
      error: params.error ?? null,
      rawStatusText: params.rawStatusText ?? null,
      mode: params.account.mode,
      broker: params.account.broker,
      brokerTicket: params.brokerTicket ?? null,
      uncertain: params.uncertain ?? false,
      confirmed: params.confirmed ?? false,
      statusTimeline: params.timeline,
      receipt: params.receipt ?? null,
    };
  }

  private buildAuditRecord(
    intent: NormalizedOrderIntent,
    account: TradingViewAccountInfo,
    result: ExecutionResult
  ): ExecutionAuditRecord {
    return {
      id: `audit-${intent.requestId}-${result.status.toLowerCase()}`,
      requestId: intent.requestId,
      userId: account.accountId || "unknown",
      accountReference: account.accountId || "unknown",
      broker: account.broker || "unknown",
      mode: account.mode,
      symbol: intent.symbol,
      action: intent.side,
      orderType: intent.orderType,
      quantity: Number(intent.quantity) || 0,
      price: intent.price ?? null,
      timestamp: result.timestamp,
      result: result.status,
      orderId: result.orderId ?? null,
      errorCode: result.error ? result.error.slice(0, 200) : null,
      strategyId: intent.strategyId ?? null,
      setupId: intent.setupId ?? null,
      accountState: account.accountState,
    };
  }

  private async sendAudit(intent: NormalizedOrderIntent, account: TradingViewAccountInfo, result: ExecutionResult): Promise<void> {
    try {
      await this.transport.postAudit(this.buildAuditRecord(intent, account, result));
    } catch {
      /* audit must never block the user flow */
    }
  }

  /**
   * Submit an order after explicit user confirmation, then poll for the real
   * gateway execution report. Never claims a fill the venue did not report.
   */
  async submitOrder(
    intent: NormalizedOrderIntent,
    account: TradingViewAccountInfo,
    options: {
      userConfirmed: boolean;
      liveAcknowledged?: boolean;
      marketPrice?: number | null;
    }
  ): Promise<ExecutionResult> {
    const timeline: ExecutionStatusEvent[] = [
      { status: "PREPARING", at: this.transport.now(), detail: null },
    ];

    // Synchronous reservation BEFORE the first await: a double-click, React
    // re-render or duplicated event can never start a second submission.
    if (inflightRequestIds.has(intent.requestId)) {
      return this.buildResult({
        requestId: intent.requestId,
        status: "PREPARING",
        account,
        timeline,
        error: `Order request ${intent.requestId} is already in flight.`,
      });
    }
    inflightRequestIds.add(intent.requestId);

    try {
      return await this.runSubmission(intent, account, options, timeline);
    } finally {
      inflightRequestIds.delete(intent.requestId);
    }
  }

  private async runSubmission(
    intent: NormalizedOrderIntent,
    account: TradingViewAccountInfo,
    options: {
      userConfirmed: boolean;
      liveAcknowledged?: boolean;
      marketPrice?: number | null;
    },
    timeline: ExecutionStatusEvent[]
  ): Promise<ExecutionResult> {
    await hydrateLedger();

    const reject = async (error: string, status: ExecutionLifecycleStatus = "REJECTED"): Promise<ExecutionResult> => {
      const result = this.buildResult({ requestId: intent.requestId, status, account, timeline, error });
      await this.sendAudit(intent, account, result);
      return result;
    };

    // 1. Explicit user confirmation is mandatory (§7).
    if (!options.userConfirmed) {
      return reject("User confirmation required prior to execution.");
    }

    // 2. Live safety: LIVE or unreported mode needs an immediate acknowledgement.
    const requiresLiveAck = account.mode === "LIVE" || account.mode === "UNKNOWN";
    if (requiresLiveAck && options.liveAcknowledged !== true) {
      return reject(
        account.mode === "LIVE"
          ? "Live account acknowledgement required before execution."
          : "Account mode is not reported — confirm you understand this order may affect a live account."
      );
    }

    // 3. Idempotency / duplicate protection (§25).
    const prior = lookupRequestId(intent.requestId);
    if (prior) {
      const base =
        prior.state === "uncertain"
          ? `Duplicate order request detected (${intent.requestId}). ${EXECUTION_UNCONFIRMED_MESSAGE}`
          : `Duplicate order request detected (${intent.requestId}). The original request was already processed.`;
      return reject(base);
    }

    // 4. Capability gate (§4): never pretend an unsupported execution path.
    const capabilities = this.getCapabilities(account);
    if (!capabilities.gatewayExecutionSupported) {
      const result = this.buildResult({
        requestId: intent.requestId,
        status: "UNAVAILABLE",
        account,
        timeline,
        error:
          account.unsupportedReason ||
          "Execution is unavailable: TradingView MCP is read-only and no execution gateway is connected.",
      });
      await this.sendAudit(intent, account, result);
      return result;
    }

    // 5. Server-side + client-side entitlement (§20).
    try {
      await this.checkEntitlement();
    } catch (err) {
      return reject(
        err instanceof Error ? err.message : "Execution entitlement check failed."
      );
    }

    // 6. Validation (§8) — block with an explanation, never guess.
    const validation = this.validateOrder(intent, account, capabilities);
    if (!validation.valid) {
      return reject(`Order validation failed: ${validation.blockedReason}`);
    }

    // 7. Execution risk check (§9).
    const risk = this.computeRiskCheck(intent, account, options.marketPrice ?? null);
    if (risk.brokerRestrictions.includes("RISK_EXCEEDED_MAX_THRESHOLD")) {
      return reject(
        `Trade rejected by the Execution Risk Check: risk exceeds the maximum threshold (${risk.notes || "see risk panel"}).`
      );
    }

    this.timelineEvent(timeline, "SUBMITTING");

    try {
      // 8. Dispatch to the real gateway with a stable idempotency key.
      const command: GatewayOrderCommand = {
        accountId: account.accountId || "",
        clientOrderId: intent.requestId,
        symbol: intent.symbol.trim().toUpperCase(),
        action: gatewayActionFor(intent),
        volume: Number(intent.quantity),
        ...(intent.orderType !== "MARKET" && intent.price ? { price: Number(intent.price) } : {}),
        ...(intent.stopLoss ? { sl: Number(intent.stopLoss) } : {}),
        ...(intent.takeProfit ? { tp: Number(intent.takeProfit) } : {}),
        comment: "AlgoVault Pro TV Bridge",
      };

      let submitResponse: { duplicate?: boolean } | null = null;
      try {
        submitResponse = await this.transport.submitOrder(command);
      } catch (err) {
        if (err instanceof OrderNotAcceptedError) {
          // Definitively not accepted — a fresh user request may retry safely.
          return reject(`Order was not accepted: ${err.message}`);
        }
        // Anything else (5xx / network) leaves the outcome unknown (§24).
        const message =
          err instanceof SubmissionUncertainError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Transport failure while submitting the order.";
        await recordRequestId(intent.requestId, "uncertain");
        const result = this.buildResult({
          requestId: intent.requestId,
          status: "UNKNOWN",
          account,
          timeline,
          error: `${EXECUTION_UNCONFIRMED_MESSAGE} (${message})`,
          uncertain: true,
        });
        await this.sendAudit(intent, account, result);
        return result;
      }

      await recordRequestId(intent.requestId, "accepted");
      this.timelineEvent(
        timeline,
        "ACCEPTED",
        submitResponse?.duplicate ? "duplicate of an earlier accepted request" : null
      );

      // 9. Poll for the real execution report (§12) — no status is invented.
      const outcome = await this.waitForExecutionReport(intent.requestId, timeline);
      this.timelineEvent(timeline, outcome.status, outcome.rawStatusText);

      if (outcome.status === "UNKNOWN") {
        const result = this.buildResult({
          requestId: intent.requestId,
          status: "UNKNOWN",
          account,
          timeline,
          error: EXECUTION_UNCONFIRMED_MESSAGE,
          uncertain: true,
          orderId: intent.requestId,
        });
        await recordRequestId(intent.requestId, "uncertain");
        await this.sendAudit(intent, account, result);
        return result;
      }

      const confirmed = outcome.status === "FILLED" || outcome.status === "PARTIALLY_FILLED" || outcome.status === "REJECTED" || outcome.status === "CANCELLED";
      const receipt: TradeReceipt | null =
        outcome.status === "FILLED" || outcome.status === "PARTIALLY_FILLED"
          ? {
              orderId: intent.requestId,
              symbol: intent.symbol.trim().toUpperCase(),
              side: intent.side,
              quantity: Number(intent.quantity),
              broker: account.broker || "Connected gateway",
              accountReference: account.accountIdMasked || account.accountId || "—",
              executionPrice: outcome.executionPrice,
              timestamp: outcome.at ?? this.transport.now(),
              mode: account.mode,
              brokerTicket: outcome.brokerTicket,
              strategyId: intent.strategyId ?? null,
              strategyName: intent.strategyName ?? null,
              setupId: intent.setupId ?? null,
              analysisId: intent.analysisId ?? null,
              timeframe: intent.timeframe ?? null,
              status: outcome.status,
              journalSynced: false,
            }
          : null;

      const result = this.buildResult({
        requestId: intent.requestId,
        status: outcome.status,
        account,
        timeline,
        error: outcome.error,
        orderId: intent.requestId,
        executionPrice: outcome.executionPrice,
        filledQuantity: outcome.filledQuantity,
        brokerTicket: outcome.brokerTicket,
        confirmed,
        rawStatusText: outcome.rawStatusText,
        receipt,
      });
      await this.sendAudit(intent, account, result);
      return result;
    } finally {
      inflightRequestIds.delete(intent.requestId);
    }
  }

  /** Poll the gateway until a real terminal report arrives or time runs out. */
  private async waitForExecutionReport(
    clientOrderId: string,
    timeline: ExecutionStatusEvent[]
  ): Promise<{
    status: ExecutionLifecycleStatus;
    executionPrice: number | null;
    filledQuantity: number | null;
    brokerTicket: string | null;
    error: string | null;
    rawStatusText: string | null;
    at: number | null;
  }> {
    const deadline = this.transport.now() + this.pollTimeoutMs;
    let lastSeen: OrderStatus | null = null;

    while (this.transport.now() < deadline) {
      let status: OrderStatus | null = null;
      try {
        status = await this.transport.getOrderStatus(clientOrderId);
      } catch {
        status = null; // transient poll error — keep trying until the deadline
      }
      if (status) {
        lastSeen = status;
        const mapped = mapGatewayOrderStatus(status.status);
        if (mapped !== "UNKNOWN" && mapped !== "ACCEPTED") {
          return {
            status: mapped,
            executionPrice:
              typeof status.executionPrice === "number" && status.executionPrice > 0
                ? status.executionPrice
                : null,
            filledQuantity: null,
            brokerTicket: status.mt5Ticket ?? null,
            error: status.errorMessage ?? null,
            rawStatusText: status.status,
            at: this.transport.now(),
          };
        }
        this.timelineEvent(timeline, "ACCEPTED", status.status);
      }
      await this.transport.sleep(this.pollIntervalMs);
    }

    if (lastSeen) {
      // Still queued/executing after the deadline — outcome unknown (§24).
      this.timelineEvent(timeline, "UNKNOWN", `no terminal report within ${this.pollTimeoutMs}ms`);
      return {
        status: "UNKNOWN",
        executionPrice: null,
        filledQuantity: null,
        brokerTicket: null,
        error: `No execution report for ${clientOrderId} (last seen: ${lastSeen.status}).`,
        rawStatusText: lastSeen.status,
        at: null,
      };
    }
    this.timelineEvent(timeline, "UNKNOWN", "order status never became visible");
    return {
      status: "UNKNOWN",
      executionPrice: null,
      filledQuantity: null,
      brokerTicket: null,
      error: "The execution status endpoint never returned this order.",
      rawStatusText: null,
      at: null,
    };
  }

  /* ── journal sync (§14) ───────────────────────────────────────────── */

  buildJournalPayload(
    receipt: TradeReceipt,
    intent: NormalizedOrderIntent,
    extras?: { marketContext?: string | null; notes?: string | null }
  ): JournalSyncPayload {
    return {
      symbol: receipt.symbol,
      direction: receipt.side,
      quantity: receipt.quantity,
      entry: receipt.executionPrice ?? intent.price ?? 0,
      stop: intent.stopLoss ?? null,
      target: intent.takeProfit ?? null,
      broker: receipt.broker,
      accountReference: receipt.accountReference,
      mode: receipt.mode,
      strategy: receipt.strategyName ?? intent.strategyName ?? null,
      strategyId: receipt.strategyId ?? intent.strategyId ?? null,
      setup: intent.setupId ?? null,
      setupId: intent.setupId ?? null,
      aiAnalysis: receipt.analysisId ?? intent.analysisId ?? null,
      analysisId: receipt.analysisId ?? intent.analysisId ?? null,
      marketContext: extras?.marketContext ?? null,
      timeframe: receipt.timeframe ?? intent.timeframe ?? null,
      timestamp: receipt.timestamp,
      executionStatus: receipt.status,
      orderId: receipt.orderId,
      brokerTicket: receipt.brokerTicket ?? null,
      notes: extras?.notes ?? null,
    };
  }

  async syncToJournal(
    receipt: TradeReceipt,
    intent: NormalizedOrderIntent,
    extras?: { marketContext?: string | null; notes?: string | null }
  ): Promise<{ ok: boolean; entryId?: string; error?: string }> {
    try {
      const payload = this.buildJournalPayload(receipt, intent, extras);
      const res = await this.transport.postJournal(payload);
      return { ok: true, entryId: res.entryId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Journal sync failed" };
    }
  }
}

export const tradingViewExecutionAdapter = new TradingViewExecutionAdapter();
