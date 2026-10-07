import { test, expect } from "@playwright/test";
import {
  TradingViewExecutionAdapter,
  resetExecutionIdempotency,
  buildUnifiedExecutionPayload,
  lifecycleForUnifiedStatus,
  newRequestId,
  type ExecutionTransport,
} from "../src/services/execution-adapter";
import {
  UnifiedTradingError,
  type UnifiedExecutionPayload,
  type UnifiedExecutionResult,
} from "../src/api/unified-trading";
import {
  buildOrderIntent,
  evaluateTicketGating,
  requiresLiveAcknowledgement,
  modeLabel,
  ticketSummary,
  createTicketRequestId,
} from "../src/services/trade-ticket";
import {
  createEmptyAccountInfo,
  maskAccountId,
  EXECUTION_UNCONFIRMED_MESSAGE,
  RISK_NOT_CALCULABLE_MESSAGE,
  type ExecutionAuditRecord,
  type ExecutionCapabilitySet,
  type JournalSyncPayload,
  type NormalizedOrderIntent,
  type TradingViewAccountInfo,
} from "../src/types/execution";
import { DEFAULT_FLAGS } from "../src/services/pro-service";

/* ── fixtures ──────────────────────────────────────────────────────── */

function makeAccount(overrides: Partial<TradingViewAccountInfo> = {}): TradingViewAccountInfo {
  return {
    ...createEmptyAccountInfo(),
    connectionStatus: "CONNECTED",
    accountState: "TRADING_ENABLED",
    tradingEnabled: true,
    accountId: "gateway_4410293",
    accountIdMasked: maskAccountId("4410293"),
    broker: "TestBroker Markets",
    mode: "DEMO",
    modeSource: "gateway",
    currency: "USD",
    balance: 10000,
    equity: 10000,
    unsupportedReason: null,
    supportedOrderTypes: ["market", "limit", "stop"],
    supportedActions: [
      "market_buy",
      "market_sell",
      "limit_buy",
      "limit_sell",
      "stop_buy",
      "stop_sell",
      "cancel_order",
      "modify_order",
      "close_position",
    ],
    dataAvailability: { positions: true, pendingOrders: true, executionHistory: true, reason: null },
    ...overrides,
  };
}

function makeIntent(overrides: Partial<NormalizedOrderIntent> = {}): NormalizedOrderIntent {
  return {
    requestId: createTicketRequestId(),
    symbol: "EURUSD",
    side: "BUY",
    orderType: "MARKET",
    quantity: 0.1,
    mode: "DEMO",
    ...overrides,
  };
}

/**
 * Builds the exact envelope `POST /api/trading/execute` returns for a request,
 * so these tests assert against the REAL Unified Trading contract instead of a
 * mock shape invented for the Extension.
 */
function unifiedResult(
  payload: UnifiedExecutionPayload,
  result: Partial<UnifiedExecutionResult> = {}
): UnifiedExecutionResult {
  return {
    clientRequestId: payload.clientRequestId,
    correlationId: `corr-${payload.clientRequestId}`,
    accountId: payload.accountId,
    provider: "MT5",
    environment: "DEMO",
    executionType: payload.executionType,
    status: "SUCCEEDED",
    providerRef: null,
    filledVolume: null,
    filledPrice: null,
    order: null,
    position: null,
    error: null,
    duplicate: false,
    createdAt: 1_000_000,
    completedAt: 1_000_100,
    ...result,
  };
}

/** A server refusal: the full envelope plus the HTTP status the route sets. */
function rejection(
  payload: UnifiedExecutionPayload,
  code: string,
  message: string,
  httpStatus: number
): UnifiedTradingError {
  return new UnifiedTradingError(message, {
    code,
    status: httpStatus,
    result: unifiedResult(payload, { status: "REJECTED", error: { code, message } }),
  });
}

interface ExecuteOptions {
  /** Fake server behaviour; defaults to a provider-confirmed fill. */
  execute?: (payload: UnifiedExecutionPayload) => Promise<UnifiedExecutionResult>;
  journalError?: boolean;
}

function makeTransport(options: ExecuteOptions = {}) {
  let clock = 1_000_000;
  const submitted: UnifiedExecutionPayload[] = [];
  const audits: ExecutionAuditRecord[] = [];
  const journals: JournalSyncPayload[] = [];

  const transport: ExecutionTransport = {
    execute: async (payload) => {
      submitted.push(payload);
      if (options.execute) return options.execute(payload);
      return unifiedResult(payload, {
        filledVolume: payload.volume ?? null,
        filledPrice: 1.1012,
        providerRef: "889900",
      });
    },
    postAudit: async (record) => {
      audits.push(record);
    },
    postJournal: async (payload) => {
      if (options.journalError) throw new Error("journal unavailable");
      journals.push(payload);
      return { entryId: "entry-1" };
    },
    now: () => clock,
  };

  return { transport, submitted, audits, journals };
}

function makeAdapter(
  options: ExecuteOptions & { entitlementError?: string; maxRiskPercent?: number } = {}
) {
  const harness = makeTransport(options);
  const adapter = new TradingViewExecutionAdapter({
    transport: harness.transport,
    checkEntitlement: options.entitlementError
      ? async () => {
          throw new Error(options.entitlementError);
        }
      : async () => undefined,
    maxRiskPercent: options.maxRiskPercent ?? 10,
  });
  return { adapter, ...harness };
}

test.beforeEach(async () => {
  await resetExecutionIdempotency();
});

/* ── §28 capability detection ──────────────────────────────────────── */

test.describe("execution capability detection", () => {
  test("TradingView MCP execution is never reported as supported", () => {
    const { adapter } = makeAdapter();
    const caps = adapter.getCapabilities(makeAccount());

    expect(caps.tradingViewMcpExecutionSupported).toBe(false);
    expect(caps.tradingViewMcpAccountSupported).toBe(false);
    expect(caps.gatewayExecutionSupported).toBe(true);
    expect(caps.supportedOrderTypes).toEqual(["MARKET", "LIMIT", "STOP"]);
    expect(caps.limitations.join(" ")).toContain("read-only");
  });

  test("without a connected gateway the capability set disables execution", () => {
    const { adapter } = makeAdapter();
    const caps = adapter.getCapabilities(
      makeAccount({ accountState: "EXECUTION_UNAVAILABLE", tradingEnabled: false, accountId: null })
    );

    expect(caps.gatewayExecutionSupported).toBe(false);
    expect(caps.gatewayPositionsSupported).toBe(false);
    expect(caps.gatewayOrderManagementSupported).toBe(false);
    expect(caps.supportedOrderTypes).toEqual([]);
    expect(caps.limitations.join(" ")).toContain("No execution gateway is connected");
  });

  test("broker venue specs stay unknown instead of guessed", () => {
    const { adapter } = makeAdapter();
    const spec = adapter.getCapabilities(makeAccount()).specification;
    expect(spec.minQuantity).toBeNull();
    expect(spec.quantityStep).toBeNull();
    expect(spec.pricePrecision).toBeNull();
  });

  test("an intent maps onto the provider-neutral Unified Trading contract", () => {
    const intent = makeIntent({
      side: "SELL",
      orderType: "LIMIT",
      price: 1.1,
      stopLoss: 1.12,
      takeProfit: 1.05,
    });
    const payload = buildUnifiedExecutionPayload(intent, makeAccount());

    expect(payload.executionType).toBe("PLACE_ORDER");
    expect(payload.clientRequestId).toBe(intent.requestId);
    expect(payload.accountId).toBe("gateway_4410293");
    expect(payload.symbol).toBe("EURUSD");
    expect(payload.side).toBe("SELL");
    expect(payload.kind).toBe("LIMIT");
    expect(payload.volume).toBe(0.1);
    expect(payload.price).toBe(1.1);
    expect(payload.stopLoss).toBe(1.12);
    expect(payload.takeProfit).toBe(1.05);

    // The Extension never names a provider, an environment or a live/demo mode.
    const keys = Object.keys(payload);
    for (const forbidden of ["provider", "environment", "userId", "ticket", "mode"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  test("a market intent sends no entry price and the MARKET kind", () => {
    const payload = buildUnifiedExecutionPayload(
      makeIntent({ side: "BUY", orderType: "MARKET", price: 1.1 }),
      makeAccount()
    );
    expect(payload.kind).toBe("MARKET");
    expect(payload.price).toBeNull();
  });

  test("Unified Trading statuses map to the bridge lifecycle", () => {
    expect(lifecycleForUnifiedStatus("SUCCEEDED")).toBe("FILLED");
    expect(lifecycleForUnifiedStatus("EXECUTED_PENDING_SYNC")).toBe("EXECUTED_PENDING_SYNC");
    expect(lifecycleForUnifiedStatus("ACCEPTED")).toBe("ACCEPTED");
    expect(lifecycleForUnifiedStatus("DUPLICATE")).toBe("ACCEPTED");
    expect(lifecycleForUnifiedStatus("REJECTED")).toBe("REJECTED");
    expect(lifecycleForUnifiedStatus("FAILED")).toBe("FAILED");
    expect(lifecycleForUnifiedStatus("UNKNOWN")).toBe("UNKNOWN");
  });
});

/* ── §8 order validation ───────────────────────────────────────────── */

test.describe("order validation", () => {
  test("detects missing symbol, invalid side and non-positive quantity", () => {
    const { adapter } = makeAdapter();
    const result = adapter.validateOrder(
      makeIntent({ symbol: "", quantity: -1, side: "BUY" as const })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Symbol is required.");
    expect(result.errors).toContain("Quantity must be a positive number.");
  });

  test("enforces stop-loss side logic", () => {
    const { adapter } = makeAdapter();
    const account = makeAccount();
    const bad = adapter.validateOrder(
      makeIntent({ orderType: "LIMIT", price: 1.08, stopLoss: 1.09, takeProfit: 1.1 }),
      account
    );
    expect(bad.valid).toBe(false);
    expect(bad.errors).toContain("Stop Loss must be below Entry Price for BUY orders.");

    const good = adapter.validateOrder(
      makeIntent({ orderType: "LIMIT", price: 1.08, stopLoss: 1.07, takeProfit: 1.1 }),
      account
    );
    expect(good.valid).toBe(true);
  });

  test("requires an entry price for LIMIT and STOP orders", () => {
    const { adapter } = makeAdapter();
    const result = adapter.validateOrder(makeIntent({ orderType: "LIMIT", price: null }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Entry price is required for LIMIT orders.");
  });

  test("blocks unsupported order types from the venue capability set", () => {
    const { adapter } = makeAdapter();
    const caps: ExecutionCapabilitySet = {
      ...adapter.getCapabilities(makeAccount()),
      supportedOrderTypes: ["MARKET"],
    };
    const result = adapter.validateOrder(
      makeIntent({ orderType: "LIMIT", price: 1.1 }),
      makeAccount(),
      caps
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("not supported by the connected execution venue");
  });

  test("enforces venue quantity/price specs only when they are known", () => {
    const { adapter } = makeAdapter();
    const account = makeAccount();
    const caps: ExecutionCapabilitySet = {
      ...adapter.getCapabilities(account),
      specification: { minQuantity: 0.1, quantityStep: 0.1, pricePrecision: 5 },
    };

    const tooSmall = adapter.validateOrder(makeIntent({ quantity: 0.05 }), account, caps);
    expect(tooSmall.valid).toBe(false);
    expect(tooSmall.errors.join(" ")).toContain("venue minimum");

    const badStep = adapter.validateOrder(makeIntent({ quantity: 0.15 }), account, caps);
    expect(badStep.valid).toBe(false);
    expect(badStep.errors.join(" ")).toContain("step of 0.1");

    const badPrecision = adapter.validateOrder(
      makeIntent({ orderType: "LIMIT", quantity: 0.1, price: 1.101234 }),
      account,
      caps
    );
    expect(badPrecision.valid).toBe(false);
    expect(badPrecision.errors.join(" ")).toContain("precision");

    const fine = adapter.validateOrder(
      makeIntent({ orderType: "LIMIT", quantity: 0.2, price: 1.10123 }),
      account,
      caps
    );
    expect(fine.valid).toBe(true);
  });

  test("blocks execution when the account state does not allow it", () => {
    const { adapter } = makeAdapter();
    const account = makeAccount({
      accountState: "EXECUTION_UNAVAILABLE",
      tradingEnabled: false,
      accountId: null,
      unsupportedReason: "TradingView MCP is read-only.",
    });
    const result = adapter.validateOrder(makeIntent(), account);
    expect(result.valid).toBe(false);
    expect(result.blockedReason).toContain("read-only");
  });

  test("warns when the account mode was never reported", () => {
    const { adapter } = makeAdapter();
    const result = adapter.validateOrder(makeIntent(), makeAccount({ mode: "UNKNOWN" }));
    expect(result.warnings.join(" ")).toContain("treated as live");
  });
});

/* ── §9 execution risk check ───────────────────────────────────────── */

test.describe("execution risk check", () => {
  test("computes exposure, risk and R:R from real inputs", () => {
    const { adapter } = makeAdapter();
    const risk = adapter.computeRiskCheck(
      makeIntent({ orderType: "LIMIT", price: 1.1, stopLoss: 1.09, takeProfit: 1.12 }),
      makeAccount()
    );

    expect(risk.riskCalculable).toBe(true);
    expect(risk.referencePrice).toBe(1.1);
    expect(risk.referencePriceSource).toBe("intent");
    expect(risk.riskAmount).toBeCloseTo(0.001, 6);
    expect(risk.potentialRiskReward).toBeCloseTo(2, 5);
    expect(risk.brokerRestrictions).not.toContain("RISK_EXCEEDED_MAX_THRESHOLD");
  });

  test("uses the market price for MARKET orders instead of inventing one", () => {
    const { adapter } = makeAdapter();
    const risk = adapter.computeRiskCheck(makeIntent({ stopLoss: 1.09 }), makeAccount(), 1.1);
    expect(risk.referencePrice).toBe(1.1);
    expect(risk.referencePriceSource).toBe("market");
    expect(risk.riskAmount).toBeCloseTo(0.001, 6);
  });

  test("declares risk non-calculable when no real price exists", () => {
    const { adapter } = makeAdapter();
    const risk = adapter.computeRiskCheck(makeIntent({ stopLoss: 1.09 }), makeAccount(), null);

    expect(risk.riskCalculable).toBe(false);
    expect(risk.referencePrice).toBeNull();
    expect(risk.estimatedExposure).toBeNull();
    expect(risk.riskAmount).toBeNull();
    expect(risk.notes).toBe(RISK_NOT_CALCULABLE_MESSAGE);
    expect(risk.missingRiskData).toContain("Reference market price");
  });

  test("reports missing account balance instead of assuming one", () => {
    const { adapter } = makeAdapter();
    const risk = adapter.computeRiskCheck(
      makeIntent({ orderType: "LIMIT", price: 1.1, stopLoss: 1.09 }),
      makeAccount({ balance: null, equity: null })
    );
    expect(risk.riskPercentage).toBeNull();
    expect(risk.missingRiskData).toContain("Account balance");
  });

  test("rejects trades above the maximum risk threshold", () => {
    const { adapter } = makeAdapter();
    const risk = adapter.computeRiskCheck(
      makeIntent({ quantity: 10, orderType: "LIMIT", price: 100, stopLoss: 80 }),
      makeAccount({ balance: 1000, equity: 1000 })
    );
    expect(risk.brokerRestrictions).toContain("RISK_EXCEEDED_MAX_THRESHOLD");
  });
});

/* ── §6 / §7 trade ticket + confirmation flow ──────────────────────── */

test.describe("trade ticket & confirmation flow", () => {
  test("ticket intent carries the stable request id and account reference", () => {
    const account = makeAccount();
    const intent = buildOrderIntent(
      {
        requestId: "ticket-abc",
        symbol: " xauusd ",
        side: "SELL",
        orderType: "LIMIT",
        quantity: 0.02,
        price: 2400,
        stopLoss: 2390,
        takeProfit: 2420,
        strategyName: "Liquidity Sweep Pro",
        setupId: "setup-9",
        timeframe: "M5",
      },
      account
    );

    expect(intent.requestId).toBe("ticket-abc");
    expect(intent.symbol).toBe("XAUUSD");
    expect(intent.accountId).toBe("gateway_4410293");
    expect(intent.mode).toBe("DEMO");
    expect(intent.strategyName).toBe("Liquidity Sweep Pro");
    expect(intent.setupId).toBe("setup-9");
    expect(intent.timeframe).toBe("M5");
  });

  test("confirmation summary only renders real values", () => {
    const account = makeAccount({ mode: "LIVE", accountIdMasked: "••••0293" });
    const lines = ticketSummary(
      makeIntent({ orderType: "LIMIT", price: 1.1, stopLoss: null, takeProfit: null }),
      account
    );
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));

    expect(byLabel.Account).toBe("••••0293");
    expect(byLabel.Broker).toBe("TestBroker Markets");
    expect(byLabel.Mode).toBe("LIVE");
    expect(byLabel["Stop / Invalidation"]).toBe("—");
    expect(byLabel["Take Profit"]).toBe("—");

    const unknownAccount = ticketSummary(
      makeIntent(),
      makeAccount({ mode: "UNKNOWN", broker: null, accountIdMasked: null })
    );
    const unknown = Object.fromEntries(unknownAccount.map((l) => [l.label, l.value]));
    expect(unknown.Account).toBe("Unavailable");
    expect(unknown.Broker).toBe("Unavailable");
    expect(unknown.Mode).toBe("MODE NOT REPORTED");
  });

  test("live acknowledgement is required for live and unreported modes only", () => {
    expect(requiresLiveAcknowledgement(makeAccount({ mode: "LIVE" }))).toBe(true);
    expect(requiresLiveAcknowledgement(makeAccount({ mode: "UNKNOWN" }))).toBe(true);
    expect(requiresLiveAcknowledgement(makeAccount({ mode: "PAPER" }))).toBe(false);
    expect(requiresLiveAcknowledgement(makeAccount({ mode: "DEMO" }))).toBe(false);
    expect(modeLabel("UNKNOWN")).toBe("MODE NOT REPORTED");
  });

  test("gating blocks confirmation until risk + acknowledgement are done", () => {
    const account = makeAccount({ mode: "LIVE" });
    const adapter = new TradingViewExecutionAdapter({ checkEntitlement: async () => undefined });
    const validation = adapter.validateOrder(makeIntent(), account);

    const before = evaluateTicketGating({
      account,
      capabilities: adapter.getCapabilities(account),
      validation,
      risk: null,
      riskEvaluated: false,
      liveAcknowledged: false,
      submitting: false,
    });
    expect(before.canConfirm).toBe(false);
    expect(before.requiresLiveAcknowledgement).toBe(true);
    expect(before.blockers.join(" ")).toContain("LIVE account");
    expect(before.blockers.join(" ")).toContain("Execution Risk Check");

    const after = evaluateTicketGating({
      account,
      capabilities: adapter.getCapabilities(account),
      validation,
      risk: adapter.computeRiskCheck(makeIntent(), account, 1.1),
      riskEvaluated: true,
      liveAcknowledged: true,
      submitting: false,
    });
    expect(after.canConfirm).toBe(true);
    expect(after.blockers).toEqual([]);
  });

  test("gating blocks everything when execution is unavailable", () => {
    const account = makeAccount({
      accountState: "EXECUTION_UNAVAILABLE",
      tradingEnabled: false,
      accountId: null,
      unsupportedReason: "TradingView MCP is read-only.",
    });
    const adapter = new TradingViewExecutionAdapter({ checkEntitlement: async () => undefined });
    const gating = evaluateTicketGating({
      account,
      capabilities: adapter.getCapabilities(account),
      validation: adapter.validateOrder(makeIntent(), account),
      risk: null,
      riskEvaluated: false,
      liveAcknowledged: false,
      submitting: false,
    });
    expect(gating.canReview).toBe(false);
    expect(gating.canConfirm).toBe(false);
    expect(gating.blockers.join(" ")).toContain("read-only");
  });

  test("paper accounts do not require a live acknowledgement", () => {
    const account = makeAccount({ mode: "PAPER" });
    const adapter = new TradingViewExecutionAdapter({ checkEntitlement: async () => undefined });
    const gating = evaluateTicketGating({
      account,
      capabilities: adapter.getCapabilities(account),
      validation: adapter.validateOrder(makeIntent(), account),
      risk: adapter.computeRiskCheck(makeIntent(), account, 1.1),
      riskEvaluated: false,
      liveAcknowledged: false,
      submitting: false,
    });
    expect(gating.requiresLiveAcknowledgement).toBe(false);
    expect(gating.canConfirm).toBe(true);
  });
});

/* ── §7 live safety / §12 lifecycle / §24 failures ─────────────────── */

test.describe("order submission lifecycle", () => {
  test("refuses to submit without explicit user confirmation", async () => {
    const { adapter, submitted } = makeAdapter();
    const result = await adapter.submitOrder(makeIntent(), makeAccount(), {
      userConfirmed: false,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.error).toContain("User confirmation required");
    expect(submitted).toHaveLength(0);
  });

  test("refuses a live order until the live acknowledgement is given", async () => {
    const { adapter, submitted } = makeAdapter();
    const result = await adapter.submitOrder(makeIntent(), makeAccount({ mode: "LIVE" }), {
      userConfirmed: true,
      liveAcknowledged: false,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.error).toContain("Live account acknowledgement required");
    expect(submitted).toHaveLength(0);
  });

  test("treats an unreported account mode as live for acknowledgement", async () => {
    const { adapter, submitted } = makeAdapter();
    const result = await adapter.submitOrder(makeIntent(), makeAccount({ mode: "UNKNOWN" }), {
      userConfirmed: true,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.error).toContain("may affect a live account");
    expect(submitted).toHaveLength(0);
  });

  test("submits ONE Unified Trading request and reports only the server-confirmed fill", async () => {
    const { adapter, submitted, audits } = makeAdapter();
    const intent = makeIntent({
      orderType: "LIMIT",
      price: 1.1,
      stopLoss: 1.09,
      strategyName: "Liquidity Sweep Pro",
    });
    const result = await adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(result.status).toBe("FILLED");
    expect(result.confirmed).toBe(true);
    expect(result.uncertain).toBe(false);
    expect(result.executionPrice).toBe(1.1012);
    expect(result.brokerTicket).toBe("889900");
    expect(result.receipt).not.toBeNull();
    expect(result.receipt?.status).toBe("FILLED");
    expect(result.receipt?.strategyName).toBe("Liquidity Sweep Pro");

    expect(submitted).toHaveLength(1);
    expect(submitted[0].clientRequestId).toBe(intent.requestId);
    expect(submitted[0].accountId).toBe("gateway_4410293");
    expect(submitted[0].executionType).toBe("PLACE_ORDER");
    expect(submitted[0].kind).toBe("LIMIT");
    expect(submitted[0].stopLoss).toBe(1.09);
    expect(submitted[0].price).toBe(1.1);

    // There is no ACCEPTED step: the API already answers with the verified
    // outcome, so nothing between SUBMITTING and FILLED is invented.
    expect(result.statusTimeline.map((e) => e.status)).toEqual([
      "PREPARING",
      "SUBMITTING",
      "FILLED",
    ]);

    expect(audits).toHaveLength(1);
    expect(audits[0].result).toBe("FILLED");
    expect(audits[0].requestId).toBe(intent.requestId);
  });

  test("surfaces the server's rejection reason verbatim and may be re-prepared", async () => {
    const { adapter, submitted } = makeAdapter({
      execute: async (payload) => {
        throw rejection(payload, "ORDER_REJECTED", "Not enough money", 422);
      },
    });
    const intent = makeIntent();
    const result = await adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.error).toBe("Not enough money");
    expect(result.receipt).toBeNull();
    expect(result.confirmed).toBe(true);
    expect(submitted).toHaveLength(1);

    // The server refused it, so nothing was traded: a new attempt is allowed
    // and must NOT be swallowed by the local duplicate guard.
    const second = await adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });
    expect(second.error ?? "").not.toContain("Duplicate order request detected");
    expect(submitted).toHaveLength(2);
    expect(submitted[1].clientRequestId).toBe(intent.requestId);
  });

  test("EXECUTED_PENDING_SYNC is a real execution, never a failure", async () => {
    const { adapter } = makeAdapter({
      execute: async (payload) =>
        unifiedResult(payload, {
          status: "EXECUTED_PENDING_SYNC",
          providerRef: "889901",
          filledPrice: 1.1015,
          filledVolume: 0.1,
        }),
    });
    const result = await adapter.submitOrder(makeIntent(), makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(result.status).toBe("EXECUTED_PENDING_SYNC");
    expect(result.confirmed).toBe(true);
    expect(result.uncertain).toBe(false);
    expect(result.error).toBeNull();
    expect(result.brokerTicket).toBe("889901");
    // The synced position is late, so no receipt is offered yet.
    expect(result.receipt).toBeNull();
  });

  test("a provider failure reported as FAILED is rendered as FAILED", async () => {
    const { adapter } = makeAdapter({
      execute: async (payload) => {
        throw new UnifiedTradingError("gateway exploded", {
          code: "UNKNOWN_PROVIDER_ERROR",
          status: 502,
          result: unifiedResult(payload, {
            status: "FAILED",
            error: { code: "UNKNOWN_PROVIDER_ERROR", message: "gateway exploded" },
          }),
        });
      },
    });
    const result = await adapter.submitOrder(makeIntent(), makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(result.status).toBe("FAILED");
    expect(result.error).toBe("gateway exploded");
    expect(result.receipt).toBeNull();
  });

  test("a transport failure yields UNKNOWN with the mandated safety message", async () => {
    const { adapter, submitted, audits } = makeAdapter({
      execute: async () => {
        throw new UnifiedTradingError("connection reset", { code: "NETWORK", status: 0 });
      },
    });
    const intent = makeIntent();

    const result = await adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.uncertain).toBe(true);
    expect(result.error).toBe(EXECUTION_UNCONFIRMED_MESSAGE);
    expect(result.receipt).toBeNull();
    expect(audits[0].result).toBe("UNKNOWN");

    // The retry MUST reuse the same idempotency key so the server decides.
    const retry = await adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });
    expect(retry.status).toBe("UNKNOWN");
    expect(retry.error).not.toContain("Duplicate order request detected");
    expect(submitted).toHaveLength(2);
    expect(new Set(submitted.map((p) => p.clientRequestId)).size).toBe(1);
  });

  test("an execution timeout is treated as an unknown outcome", async () => {
    const { adapter } = makeAdapter({
      execute: async (payload) => {
        throw new UnifiedTradingError("gateway did not confirm in time", {
          code: "EXECUTION_TIMEOUT",
          status: 504,
          result: unifiedResult(payload, {
            status: "FAILED",
            error: { code: "EXECUTION_TIMEOUT", message: "gateway did not confirm in time" },
          }),
        });
      },
    });
    const result = await adapter.submitOrder(makeIntent(), makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(result.status).toBe("UNKNOWN");
    expect(result.uncertain).toBe(true);
    expect(result.error).toContain(EXECUTION_UNCONFIRMED_MESSAGE);
  });

  test("a 409 duplicate in flight is reported as accepted, awaiting confirmation", async () => {
    const { adapter } = makeAdapter({
      execute: async (payload) => {
        throw rejection(
          payload,
          "DUPLICATE_REQUEST",
          "An identical request is already in flight. Wait for the original result.",
          409
        );
      },
    });
    const result = await adapter.submitOrder(makeIntent(), makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(result.status).toBe("ACCEPTED");
    expect(result.error).toBe("Order accepted — waiting for broker confirmation");
    expect(result.receipt).toBeNull();
    expect(result.uncertain).toBe(false);
  });

  test("unsupported execution returns UNAVAILABLE without touching the transport", async () => {
    const { adapter, submitted } = makeAdapter();
    const account = makeAccount({
      accountState: "EXECUTION_UNAVAILABLE",
      tradingEnabled: false,
      accountId: null,
      unsupportedReason: "TradingView MCP is read-only.",
    });

    const result = await adapter.submitOrder(makeIntent(), account, {
      userConfirmed: true,
      liveAcknowledged: true,
    });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.error).toContain("read-only");
    expect(submitted).toHaveLength(0);
  });

  test("server-side entitlement failure blocks submission", async () => {
    const { adapter, submitted } = makeAdapter({ entitlementError: "Pro entitlement required" });
    const result = await adapter.submitOrder(makeIntent(), makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(result.status).toBe("REJECTED");
    expect(result.error).toContain("Pro entitlement required");
    expect(submitted).toHaveLength(0);
  });

  test("risk guard rejects an order above the threshold before dispatch", async () => {
    const { adapter, submitted } = makeAdapter();
    const account = makeAccount({ balance: 1000, equity: 1000 });
    const intent = makeIntent({
      quantity: 10,
      orderType: "LIMIT",
      price: 100,
      stopLoss: 80,
      mode: "LIVE",
    });

    const result = await adapter.submitOrder(intent, account, {
      userConfirmed: true,
      liveAcknowledged: true,
    });
    expect(result.status).toBe("REJECTED");
    expect(result.error).toContain("Execution Risk Check");
    expect(submitted).toHaveLength(0);
  });

  test("a duplicate click while in flight never dispatches twice", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { adapter, submitted } = makeAdapter({
      execute: async (payload) => {
        await gate;
        return unifiedResult(payload, { filledPrice: 1.1, providerRef: "889900" });
      },
    });
    const intent = makeIntent();

    const first = adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });
    const second = await adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(second.status).toBe("PREPARING");
    expect(second.error).toContain("already in flight");

    release();
    const completed = await first;
    expect(completed.status).toBe("FILLED");
    expect(submitted).toHaveLength(1);
  });
});

/* ── §25 idempotency across reloads ────────────────────────────────── */

test.describe("duplicate order protection", () => {
  test("a completed request id cannot be replayed", async () => {
    const { adapter, submitted } = makeAdapter();
    const intent = makeIntent();

    const first = await adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });
    expect(first.status).toBe("FILLED");

    const replay = await adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });
    expect(replay.status).toBe("REJECTED");
    expect(replay.error).toContain("Duplicate order request detected");
    expect(submitted).toHaveLength(1);
  });

  test("the ledger survives an extension reload (persisted storage)", async () => {
    // Fake chrome.storage.local so the idempotency ledger can persist.
    const store: Record<string, unknown> = {};
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: (key: string, cb: (res: Record<string, unknown>) => void) =>
            cb({ [key]: store[key] }),
          set: (payload: Record<string, unknown>, cb?: () => void) => {
            Object.assign(store, payload);
            cb?.();
          },
          remove: (key: string, cb?: () => void) => {
            delete store[key];
            cb?.();
          },
        },
      },
    };

    try {
      const { adapter } = makeAdapter();
      const intent = makeIntent();
      await adapter.submitOrder(intent, makeAccount(), {
        userConfirmed: true,
        liveAcknowledged: true,
      });

      // Simulate an extension reload: memory wiped, storage kept.
      await resetExecutionIdempotency({ clearPersisted: false });

      const afterReload = await adapter.submitOrder(intent, makeAccount(), {
        userConfirmed: true,
        liveAcknowledged: true,
      });
      expect(afterReload.status).toBe("REJECTED");
      expect(afterReload.error).toContain("Duplicate order request detected");
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
      await resetExecutionIdempotency();
    }
  });
});

/* ── §14 journal sync + §23 audit ──────────────────────────────────── */

test.describe("journal & audit integration", () => {
  test("journal payload carries the intelligence provenance", async () => {
    const { adapter, journals } = makeAdapter();
    const intent = makeIntent({
      strategyId: "strat-1",
      strategyName: "Liquidity Sweep Pro",
      setupId: "setup-7",
      analysisId: "analysis-3",
      timeframe: "M5",
      stopLoss: 1.09,
      takeProfit: 1.12,
    });

    await adapter.submitOrder(intent, makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    const receipt = adapter.buildJournalPayload(
      {
        orderId: intent.requestId,
        symbol: "EURUSD",
        side: "BUY",
        quantity: 0.1,
        broker: "TestBroker Markets",
        accountReference: "••••0293",
        executionPrice: 1.1,
        timestamp: 123,
        mode: "DEMO",
        status: "FILLED",
        journalSynced: false,
      },
      intent
    );

    expect(receipt.strategyId).toBe("strat-1");
    expect(receipt.strategy).toBe("Liquidity Sweep Pro");
    expect(receipt.setupId).toBe("setup-7");
    expect(receipt.analysisId).toBe("analysis-3");
    expect(receipt.timeframe).toBe("M5");
    expect(receipt.stop).toBe(1.09);
    expect(receipt.target).toBe(1.12);
    expect(receipt.executionStatus).toBe("FILLED");
    expect(receipt.accountReference).toBe("••••0293");
  });

  test("journal sync failures degrade to a reported error", async () => {
    const { adapter } = makeAdapter({ journalError: true });
    const intent = makeIntent();
    const res = await adapter.syncToJournal(
      {
        orderId: "r1",
        symbol: "EURUSD",
        side: "BUY",
        quantity: 0.1,
        broker: "B",
        accountReference: "••••1234",
        executionPrice: 1.1,
        timestamp: 1,
        mode: "DEMO",
        status: "FILLED",
        journalSynced: false,
      },
      intent
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("journal unavailable");
  });

  test("audit records never contain credential-shaped keys", async () => {
    const { adapter, audits } = makeAdapter();
    await adapter.submitOrder(makeIntent(), makeAccount(), {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(audits.length).toBeGreaterThan(0);
    for (const record of audits) {
      const keys = Object.keys(record).map((k) => k.toLowerCase());
      for (const pattern of ["password", "secret", "token", "cookie", "apikey", "private"]) {
        expect(keys.some((k) => k.includes(pattern))).toBe(false);
      }
    }
    expect(audits[0].accountReference).toBe("gateway_4410293");
    expect(audits[0].broker).toBe("TestBroker Markets");
  });
});

/* ── §20 Pro entitlement (fail-closed) + §19 security ──────────────── */

test.describe("entitlement & security boundaries", () => {
  test("execution feature flags fail closed by default", () => {
    expect(DEFAULT_FLAGS.tradingViewExecutionBridge).toBe(false);
    expect(DEFAULT_FLAGS.tradingViewProExtension).toBe(false);
  });

  test("account snapshots never expose credential material", () => {
    const account = makeAccount();
    const serialized = JSON.stringify(account).toLowerCase();
    for (const pattern of ["password", "secret", "cookie", "api_key", "apikey", "privatekey"]) {
      expect(serialized.includes(pattern)).toBe(false);
    }
  });

  test("a missing account reference blocks dispatch instead of guessing", async () => {
    const { adapter, submitted } = makeAdapter();
    const account = makeAccount({ accountId: null, accountState: "TRADING_ENABLED" });

    const result = await adapter.submitOrder(makeIntent(), account, {
      userConfirmed: true,
      liveAcknowledged: true,
    });

    expect(result.status).toBe("UNAVAILABLE");
    expect(submitted).toHaveLength(0);
  });
});
