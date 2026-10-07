import { test, expect } from "@playwright/test";
import {
  detectTradingViewAccount,
  clearAccountCache,
  accountAgeLabel,
  normalizePositionRow,
  normalizePendingOrderRow,
  normalizeUnifiedHistory,
  subscribeTVAccount,
  type AccountTransport,
} from "../src/services/tv-account-service";
import {
  createEmptyAccountInfo,
  maskAccountId,
  type TradingViewPageAccountSignal,
} from "../src/types/execution";
import type { GatewayStatus } from "../src/types";
import type { UnifiedHistoryEntry } from "../src/api/unified-trading";

/* ── fixtures ──────────────────────────────────────────────────────── */

const GATEWAY_ACCOUNT = {
  accountId: "gateway_4410293",
  accountNumber: "4410293",
  broker: "TestBroker Markets",
  server: "TestBroker-Live01",
  balance: 12500.5,
  equity: 12610.25,
  currency: "USD",
  margin: 620.25,
  freeMargin: 11990,
  marginLevel: 2033.4,
  positionsCount: 2,
  pendingOrdersCount: 1,
  status: "connected",
  lastHeartbeatAt: 1_700_000_000_000,
};

const POSITIONS = [
  {
    ticket: "991122",
    symbol: "XAUUSD",
    type: "BUY",
    volume: 0.02,
    openPrice: 2401.5,
    currentPrice: 2409.75,
    sl: 2395,
    tp: 2420,
    profit: 16.5,
    openedAt: 1_700_000_000_000,
  },
  {
    ticket: "991123",
    symbol: "EURUSD",
    type: "SELL",
    volume: 0.1,
    openPrice: 1.0851,
    // profit/currentPrice intentionally missing — must stay null
    sl: 1.09,
    tp: 1.07,
    openedAt: 1_700_000_100_000,
  },
];

const PENDING = [
  {
    ticket: "551122",
    symbol: "XAUUSD",
    type: "BUY_LIMIT",
    volume: 0.03,
    price: 2380,
    sl: 2370,
    tp: 2410,
    status: "placed",
    updatedAt: 1_700_000_200_000,
  },
  {
    ticket: "551123",
    symbol: "GBPUSD",
    type: "SELL_STOP",
    volume: 0.05,
    price: 1.2501,
    sl: 1.255,
    tp: 1.24,
    updatedAt: 1_700_000_300_000,
  },
];

/**
 * Unified Trading history entries as `GET /api/trading/history` returns them.
 * Terminal states (FILLED / REJECTED) are history; a SUBMITTED command is
 * still in flight and must not be listed — same display contract as before.
 */
const HISTORY_ENTRIES: UnifiedHistoryEntry[] = [
  {
    clientRequestId: "req-filled-1",
    accountId: GATEWAY_ACCOUNT.accountId,
    symbol: "XAUUSD",
    side: "BUY",
    kind: "MARKET",
    executionType: "PLACE_ORDER",
    volume: 0.02,
    filledVolume: 0.02,
    price: 2401.5,
    stopLoss: null,
    takeProfit: null,
    providerRef: "991100",
    state: "FILLED",
    result: "SUCCEEDED",
    errorMessage: null,
    createdAt: 1_700_000_400_000,
    executedAt: 1_700_000_405_000,
  },
  {
    clientRequestId: "req-rejected-1",
    accountId: GATEWAY_ACCOUNT.accountId,
    symbol: "EURUSD",
    side: "SELL",
    kind: "MARKET",
    executionType: "PLACE_ORDER",
    volume: 0.1,
    filledVolume: null,
    price: 1.0851,
    stopLoss: null,
    takeProfit: null,
    providerRef: null,
    state: "REJECTED",
    result: "REJECTED",
    errorMessage: "Invalid volume",
    createdAt: 1_700_000_500_000,
    executedAt: null,
  },
  {
    clientRequestId: "req-still-queued",
    accountId: GATEWAY_ACCOUNT.accountId,
    symbol: "GBPUSD",
    side: "BUY",
    kind: "MARKET",
    executionType: "PLACE_ORDER",
    volume: 0.01,
    filledVolume: null,
    price: null,
    stopLoss: null,
    takeProfit: null,
    providerRef: null,
    state: "SUBMITTED",
    result: "ACCEPTED",
    errorMessage: null,
    createdAt: 1_700_000_600_000,
    executedAt: null,
  },
];

function gatewayStatus(overrides: Partial<GatewayStatus> = {}): GatewayStatus {
  return {
    connected: true,
    accounts: [{ ...GATEWAY_ACCOUNT }],
    licenseValid: true,
    ...overrides,
  };
}

function pageSignal(overrides: Partial<TradingViewPageAccountSignal> = {}): TradingViewPageAccountSignal {
  return {
    pageReachable: true,
    paperTrading: false,
    brokerLabel: null,
    liveBadge: false,
    detectedAt: 1_700_000_700_000,
    ...overrides,
  };
}

interface TransportOverrides {
  gateway?: GatewayStatus | Error;
  positions?: Record<string, unknown>[] | Error;
  pending?: Record<string, unknown>[] | Error;
  history?: UnifiedHistoryEntry[] | Error;
  server?: unknown;
  page?: TradingViewPageAccountSignal | null;
}

function makeTransport(overrides: TransportOverrides = {}) {
  const calls = { gateway: 0, positions: 0, pending: 0, history: 0, server: 0, page: 0 };

  const unwrap = <T>(value: T | Error | undefined, fallback: T): T => {
    if (value instanceof Error) throw value;
    return (value as T) ?? fallback;
  };

  const transport: AccountTransport = {
    getGatewayStatus: async () => {
      calls.gateway += 1;
      return unwrap(overrides.gateway, { connected: false, accounts: [], licenseValid: false });
    },
    getPositions: async () => {
      calls.positions += 1;
      return unwrap(overrides.positions, []) as never;
    },
    getPendingOrders: async () => {
      calls.pending += 1;
      return unwrap(overrides.pending, []) as never;
    },
    getExecutionHistory: async () => {
      calls.history += 1;
      return unwrap(overrides.history, []) as never;
    },
    getTvAccountStatus: async () => {
      calls.server += 1;
      if (overrides.server instanceof Error) throw overrides.server;
      return (overrides.server ?? null) as never;
    },
    readTradingViewPageSignal: async () => {
      calls.page += 1;
      return overrides.page ?? null;
    },
  };

  return { transport, calls };
}

async function detect(overrides: TransportOverrides = {}, force = true) {
  const { transport, calls } = makeTransport(overrides);
  const info = await detectTradingViewAccount({ force, transport });
  return { info, calls };
}

test.beforeEach(() => {
  clearAccountCache();
});

/* ── §1 account detection ──────────────────────────────────────────── */

test.describe("account detection", () => {
  test("a connected gateway yields a fully populated execution account", async () => {
    const { info, calls } = await detect({
      gateway: gatewayStatus(),
      positions: POSITIONS,
      pending: PENDING,
      history: HISTORY_ENTRIES,
    });

    expect(info.accountState).toBe("TRADING_ENABLED");
    expect(info.connectionStatus).toBe("CONNECTED");
    expect(info.tradingEnabled).toBe(true);
    expect(info.broker).toBe("TestBroker Markets");
    expect(info.accountId).toBe("gateway_4410293");
    expect(info.accountIdMasked).toBe("••••0293");
    expect(info.currency).toBe("USD");
    expect(info.balance).toBe(12500.5);
    expect(info.equity).toBe(12610.25);
    expect(info.marginUsed).toBe(620.25);
    expect(info.marginFree).toBe(11990);
    expect(info.marginLevel).toBeCloseTo(2033.4, 3);
    expect(info.supportedOrderTypes).toEqual(["market", "limit", "stop"]);
    expect(info.dataAvailability.positions).toBe(true);
    expect(info.dataAvailability.pendingOrders).toBe(true);
    expect(info.dataAvailability.executionHistory).toBe(true);
    expect(calls.gateway).toBe(1);
  });

  test("positions keep only values the gateway actually reported", async () => {
    const { info } = await detect({ gateway: gatewayStatus(), positions: POSITIONS });

    expect(info.openPositions).toHaveLength(2);
    const long = info.openPositions[0];
    expect(long.symbol).toBe("XAUUSD");
    expect(long.side).toBe("BUY");
    expect(long.quantity).toBe(0.02);
    expect(long.entryPrice).toBe(2401.5);
    expect(long.currentPrice).toBe(2409.75);
    expect(long.unrealizedPnl).toBe(16.5);
    expect(long.stopLoss).toBe(2395);
    expect(long.takeProfit).toBe(2420);
    expect(long.status).toBe("OPEN");
    expect(long.broker).toBe("TestBroker Markets");

    const short = info.openPositions[1];
    expect(short.side).toBe("SELL");
    // Missing gateway values stay null — never fabricated.
    expect(short.currentPrice).toBeNull();
    expect(short.unrealizedPnl).toBeNull();
  });

  test("pending orders are normalized from real gateway rows", async () => {
    const { info } = await detect({ gateway: gatewayStatus(), pending: PENDING });

    expect(info.pendingOrders).toHaveLength(2);
    const [limit, stop] = info.pendingOrders;
    expect(limit.side).toBe("BUY");
    expect(limit.orderType).toBe("LIMIT");
    expect(limit.price).toBe(2380);
    expect(limit.timestamp).toBe(1_700_000_200_000);
    expect(stop.side).toBe("SELL");
    expect(stop.orderType).toBe("STOP");
    expect(stop.price).toBe(1.2501);
    expect(stop.canCancel).toBe(true);
  });

  test("execution history only lists terminal order requests", async () => {
    const { info } = await detect({ gateway: gatewayStatus(), history: HISTORY_ENTRIES });

    expect(info.executionHistory).toHaveLength(2);
    const ids = info.executionHistory.map((h) => h.requestId);
    expect(ids).toContain("req-filled-1");
    expect(ids).toContain("req-rejected-1");
    expect(ids).not.toContain("req-still-queued");

    const rejected = info.executionHistory.find((h) => h.requestId === "req-rejected-1");
    expect(rejected?.errorMessage).toBe("Invalid volume");
  });

  test("no sources at all means NOT_CONNECTED with no invented metadata", async () => {
    const { info } = await detect({});

    expect(info.accountState).toBe("NOT_CONNECTED");
    expect(info.mode).toBe("UNKNOWN");
    expect(info.broker).toBeNull();
    expect(info.accountId).toBeNull();
    expect(info.accountIdMasked).toBeNull();
    expect(info.balance).toBeNull();
    expect(info.equity).toBeNull();
    expect(info.openPositions).toEqual([]);
    expect(info.unsupportedReason).toContain("read-only");
  });
});

/* ── §2 broker detection ───────────────────────────────────────────── */

test.describe("broker detection", () => {
  test("the gateway-reported broker is used verbatim", async () => {
    const { info } = await detect({ gateway: gatewayStatus() });
    expect(info.broker).toBe("TestBroker Markets");
    expect(info.source).toBe("gateway");
  });

  test("a TradingView page broker label is only used when it really exists", async () => {
    const { info } = await detect({
      gateway: { connected: false, accounts: [], licenseValid: false },
      page: pageSignal({ brokerLabel: "TV Broker Panel" }),
    });
    expect(info.broker).toBe("TV Broker Panel");
    expect(info.source).toBe("tradingview-dom");
  });

  test("no broker is reported when no source provides one", async () => {
    const { info } = await detect({ gateway: gatewayStatus({ accounts: [{ ...GATEWAY_ACCOUNT, broker: "" }] }) });
    expect(info.broker).toBeNull();
  });
});

/* ── §3 account states ─────────────────────────────────────────────── */

test.describe("account states", () => {
  test("TradingView page without an execution gateway → EXECUTION_UNAVAILABLE", async () => {
    const { info } = await detect({ page: pageSignal() });
    expect(info.accountState).toBe("EXECUTION_UNAVAILABLE");
    expect(info.tradingEnabled).toBe(false);
    expect(info.connectionStatus).toBe("CONNECTED");
    expect(info.dataAvailability.positions).toBe(false);
    expect(info.dataAvailability.reason).toContain("read-only");
  });

  test("expired TradingView authorization → AUTHENTICATION_REQUIRED", async () => {
    const { info } = await detect({
      server: {
        success: true,
        connection: { state: "TOKEN_EXPIRED", authorized: false, message: "Reconnect." },
        capabilities: [],
        execution: {
          tradingViewMcpExecutionSupported: false,
          gatewayExecutionSupported: false,
          reason: "read-only",
        },
        accountState: "AUTHENTICATION_REQUIRED",
        timestamp: Date.now(),
      },
    });

    expect(info.accountState).toBe("AUTHENTICATION_REQUIRED");
    expect(info.tradingView.mcpState).toBe("TOKEN_EXPIRED");
    expect(info.tradingView.mcpAuthorized).toBe(false);
    expect(info.unsupportedReason).toContain("expired");
  });

  test("gateway outage surfaces ERROR without fabricating data", async () => {
    const { info } = await detect({ gateway: new Error("network down") });

    expect(info.accountState).toBe("ERROR");
    expect(info.connectionStatus).toBe("ERROR");
    expect(info.balance).toBeNull();
    expect(info.unsupportedReason).toContain("Could not reach");
  });

  test("an MCP status failure never breaks account detection", async () => {
    const { info } = await detect({
      gateway: gatewayStatus(),
      server: new Error("mcp unavailable"),
    });
    expect(info.accountState).toBe("TRADING_ENABLED");
    expect(info.tradingView.mcpState).toBeNull();
  });

  test("the empty account is NOT_CONNECTED and fails closed", () => {
    const empty = createEmptyAccountInfo();
    expect(empty.accountState).toBe("NOT_CONNECTED");
    expect(empty.tradingEnabled).toBe(false);
    expect(empty.supportedOrderTypes).toEqual([]);
    expect(empty.supportedActions).toEqual([]);
    expect(empty.balance).toBeNull();
    expect(empty.mode).toBe("UNKNOWN");
    expect(empty.source).toBe("unavailable");
  });
});

/* ── §22 paper vs live distinction ─────────────────────────────────── */

test.describe("paper vs live distinction", () => {
  test("an active TradingView paper panel is reported as PAPER", async () => {
    const { info } = await detect({ page: pageSignal({ paperTrading: true }) });
    expect(info.mode).toBe("PAPER");
    expect(info.modeSource).toBe("tradingview-dom");
  });

  test("an explicit TradingView live badge is reported as LIVE", async () => {
    const { info } = await detect({ page: pageSignal({ liveBadge: true }) });
    expect(info.mode).toBe("LIVE");
  });

  test("the execution destination mode stays UNKNOWN when nothing reports it", async () => {
    // The gateway does not publish live/demo — the panel must never pretend
    // the routed account is paper.
    const { info } = await detect({
      gateway: gatewayStatus(),
      page: pageSignal({ paperTrading: true }),
    });
    expect(info.mode).toBe("UNKNOWN");
    expect(info.modeSource).toBe("gateway");
  });

  test("no mode signal stays UNKNOWN rather than defaulting to paper", async () => {
    const { info } = await detect({});
    expect(info.mode).toBe("UNKNOWN");
    expect(info.modeSource).toBe("unavailable");
  });
});

/* ── §18 sync, caching and freshness ───────────────────────────────── */

test.describe("account sync", () => {
  test("repeated detections within the TTL reuse the cache (deduplication)", async () => {
    const { transport, calls } = makeTransport({ gateway: gatewayStatus() });

    const first = await detectTradingViewAccount({ transport });
    const second = await detectTradingViewAccount({ transport });

    expect(calls.gateway).toBe(1);
    expect(second.lastSyncTimestamp).toBe(first.lastSyncTimestamp);
  });

  test("a forced detection refreshes and notifies subscribers", async () => {
    const { transport, calls } = makeTransport({ gateway: gatewayStatus() });

    // Populate the cache through the injected transport first, then subscribe
    // so no default (network) transport is ever touched inside the test.
    await detectTradingViewAccount({ transport, force: true });

    const seen: string[] = [];
    const unsubscribe = subscribeTVAccount((info) => seen.push(info.accountState));
    try {
      expect(seen).toContain("TRADING_ENABLED");
      await detectTradingViewAccount({ transport, force: true });
      expect(seen.filter((s) => s === "TRADING_ENABLED").length).toBeGreaterThanOrEqual(2);
      expect(calls.gateway).toBeGreaterThanOrEqual(2);
    } finally {
      unsubscribe();
    }
  });

  test("freshness labels describe the last successful sync", async () => {
    const now = 1_700_000_000_000;
    const info = {
      ...createEmptyAccountInfo(),
      lastSyncTimestamp: now,
    };

    expect(accountAgeLabel(info, now + 1_000)).toBe("Just now");
    expect(accountAgeLabel(info, now + 4_000)).toBe("Just now");
    expect(accountAgeLabel(info, now + 12_000)).toBe("Updated 12s ago");
    expect(accountAgeLabel(info, now + 125_000)).toBe("Updated 2m ago");
  });
});

/* ── §19 security boundaries ───────────────────────────────────────── */

test.describe("security boundaries", () => {
  test("account snapshots contain no credential-shaped keys", async () => {
    const { info } = await detect({ gateway: gatewayStatus(), positions: POSITIONS });
    const serialized = JSON.stringify(info).toLowerCase();

    for (const pattern of ["password", "secret", "cookie", "api_key", "privatekey"]) {
      expect(serialized.includes(pattern)).toBe(false);
    }
  });

  test("account identifiers are masked for display", () => {
    expect(maskAccountId("4410293")).toBe("••••0293");
    expect(maskAccountId("1234")).toBe("••••1234");
    expect(maskAccountId(null)).toBeNull();
    expect(maskAccountId(undefined)).toBeNull();
    expect(maskAccountId("abcd")).toBe("••••");
  });

  test("no password/token fields exist on the empty account shape", () => {
    const keys = Object.keys(createEmptyAccountInfo()).map((k) => k.toLowerCase());
    expect(keys.some((k) => k.includes("password"))).toBe(false);
    expect(keys.some((k) => k.includes("token"))).toBe(false);
    expect(keys.some((k) => k.includes("secret"))).toBe(false);
  });
});

/* ── §10 / §11 normalization edge cases ────────────────────────────── */

test.describe("position & order normalization", () => {
  test("rows without a ticket or symbol are dropped, not guessed", () => {
    expect(normalizePositionRow({ symbol: "XAUUSD" }, null, null)).toBeNull();
    expect(normalizePositionRow({ ticket: "1" }, null, null)).toBeNull();
    expect(normalizePendingOrderRow({ ticket: "1" }, null, null)).toBeNull();
  });

  test("zero-valued prices and P/L stay truthful", () => {
    const pos = normalizePositionRow(
      { ticket: "7", symbol: "XAUUSD", type: "BUY", volume: 0.01, openPrice: 0 },
      "B",
      "A"
    );
    expect(pos?.entryPrice).toBe(0);
    expect(pos?.currentPrice).toBeNull();
    expect(pos?.unrealizedPnl).toBeNull();
    expect(pos?.stopLoss).toBeNull();
  });

  test("unknown pending order types keep a null price instead of a fabricated one", () => {
    const row = normalizePendingOrderRow(
      { ticket: "8", symbol: "XAUUSD", type: "WEIRD_TYPE", volume: 1 },
      "B",
      "A"
    );
    expect(row?.price).toBeNull();
    expect(row?.status).toBe("PENDING");
    expect(row?.stopLoss).toBeNull();
  });

  test("execution history ignores malformed rows", () => {
    const rows = normalizeUnifiedHistory([
      { clientRequestId: "", state: "FILLED" } as UnifiedHistoryEntry,
      { state: "FILLED" } as UnifiedHistoryEntry,
    ]);
    expect(rows).toHaveLength(0);
  });
});

/* ── Unified history → display model mapping ──────────────────────── */

test.describe("unified history mapping", () => {
  test("the Unified history response maps into the existing display model", () => {
    const rows = normalizeUnifiedHistory(HISTORY_ENTRIES);
    expect(rows).toHaveLength(2);

    const [filled, rejected] = rows;
    expect(filled.requestId).toBe("req-filled-1");
    expect(filled.symbol).toBe("XAUUSD");
    expect(filled.side).toBe("BUY");
    expect(filled.orderType).toBe("MARKET");
    // Actual filled volume, not merely the requested one.
    expect(filled.quantity).toBe(0.02);
    // Actual execution price reported by the provider.
    expect(filled.price).toBe(2401.5);
    expect(filled.status).toBe("FILLED");
    // Provider ticket / reference.
    expect(filled.orderId).toBe("991100");
    expect(filled.executedAt).toBe(1_700_000_405_000);
    expect(filled.createdAt).toBe(1_700_000_400_000);

    expect(rejected.requestId).toBe("req-rejected-1");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.errorMessage).toBe("Invalid volume");
    expect(rejected.orderId).toBeNull();
    expect(rejected.quantity).toBe(0.1);
  });

  test("management actions keep their verb and in-flight states stay hidden", () => {
    const rows = normalizeUnifiedHistory([
      {
        clientRequestId: "close-1",
        accountId: GATEWAY_ACCOUNT.accountId,
        symbol: "XAUUSD",
        side: "BUY",
        kind: "MARKET",
        executionType: "CLOSE_POSITION",
        volume: 0.02,
        filledVolume: 0.02,
        price: 2410,
        stopLoss: null,
        takeProfit: null,
        providerRef: "991200",
        state: "FILLED",
        result: "SUCCEEDED",
        errorMessage: null,
        createdAt: 1_700_000_800_000,
        executedAt: 1_700_000_801_000,
      },
      { clientRequestId: "in-flight-1", state: "SUBMITTED" } as UnifiedHistoryEntry,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].side).toBe("CLOSE");
    expect(rows[0].status).toBe("FILLED");
    expect(rows[0].orderType).toBe("MARKET");
  });
});
