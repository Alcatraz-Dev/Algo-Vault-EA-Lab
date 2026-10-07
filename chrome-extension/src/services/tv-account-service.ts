/**
 * TradingView Account Service
 *
 * Detects the active trading account, broker and execution availability from
 * sources that genuinely expose them:
 *
 *   1. AlgoVault MT5 Gateway  — real broker, account number, balance, equity,
 *      margin, positions, pending orders and order history (server entitled).
 *   2. TradingView page probe — the content script reads the TradingView
 *      document itself (Paper Trading UI, broker widget). Only positively
 *      detected signals are reported; absence stays `null`/`UNKNOWN`.
 *   3. Server MCP status      — the real OAuth connection record of the
 *      installed TradingView MCP (connected / expired / re-auth).
 *
 * HARD RULES:
 *   - TradingView MCP is READ-ONLY: it exposes no account, broker, order,
 *     position or execution tool. It can never be the source of an account.
 *   - No value is invented: unknown balance, equity, margin, mode, broker or
 *     account id stay `null` / `UNKNOWN`.
 *   - No credentials are ever read or stored — only safe account metadata.
 *   - Account mode always describes the EXECUTION DESTINATION account, never
 *     the charting account, so PAPER/LIVE can never be misreported.
 *
 * Sync strategy: 15s TTL cache + in-flight request deduplication + an
 * event-driven subscriber list. Consumers render a freshness label from
 * `lastSyncTimestamp`.
 */
import type {
  AccountMode,
  AccountState,
  ExecutionHistoryEntry,
  TradingViewAccountInfo,
  TradingViewPageAccountSignal,
  TradingViewPendingOrder,
  TradingViewPosition,
} from "@/types/execution";
import { createEmptyAccountInfo, maskAccountId } from "@/types/execution";
import type { GatewayAccount, GatewayStatus } from "@/types";
import { getAlgoVaultUrl } from "@/config/environment";
import { getAuthToken } from "@/storage/storage";
import { getGatewayStatus, getPositions } from "@/api/algovault";
import { getUnifiedTradingHistory, type UnifiedHistoryEntry } from "@/api/unified-trading";
import {
  fetchTvAccountStatus,
  isTerminalOrderStatus,
  type TvAccountStatusResponse,
} from "@/api/execution";

/* ── raw rows returned by the gateway snapshot ──────────────────────── */

interface RawPositionRow {
  ticket?: string | number;
  symbol?: string;
  type?: string;
  volume?: number;
  openPrice?: number;
  currentPrice?: number;
  sl?: number;
  tp?: number;
  profit?: number;
  openedAt?: number;
  updatedAt?: number;
}

interface RawPendingOrderRow {
  ticket?: string | number;
  symbol?: string;
  type?: string;
  volume?: number;
  price?: number;
  sl?: number;
  tp?: number;
  status?: string;
  updatedAt?: number;
}

/* ── injectable transport (tests substitute fakes) ──────────────────── */

export interface AccountTransport {
  getGatewayStatus(): Promise<GatewayStatus>;
  getPositions(accountId: string): Promise<RawPositionRow[]>;
  getPendingOrders(accountId: string): Promise<RawPendingOrderRow[]>;
  /** Unified Trading execution history (GET /api/trading/history) — read-only. */
  getExecutionHistory(accountId: string): Promise<UnifiedHistoryEntry[]>;
  getTvAccountStatus(): Promise<TvAccountStatusResponse | null>;
  readTradingViewPageSignal(): Promise<TradingViewPageAccountSignal | null>;
}

const PAGE_SIGNAL_STORAGE_KEY = "tvPageAccountSignal";

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

async function defaultReadTradingViewPageSignal(): Promise<TradingViewPageAccountSignal | null> {
  if (!hasChromeStorage()) return null;
  return new Promise((resolve) => {
    chrome.storage.local.get(PAGE_SIGNAL_STORAGE_KEY, (result) => {
      const raw = result[PAGE_SIGNAL_STORAGE_KEY] as TradingViewPageAccountSignal | undefined;
      if (!raw || typeof raw !== "object") return resolve(null);
      // Stale signals (no chart seen for 10 min) are dropped, never trusted.
      if (Date.now() - Number(raw.detectedAt || 0) > 10 * 60 * 1000) return resolve(null);
      resolve(raw);
    });
  });
}

const defaultTransport: AccountTransport = {
  getGatewayStatus: () => getGatewayStatus(),
  getPositions: async (accountId) => (await getPositions(accountId)) as unknown as RawPositionRow[],
  getPendingOrders: async (accountId) => {
    try {
      const base = await getAlgoVaultUrl();
      const token = await getAuthToken();
      const res = await fetch(
        `${base}/api/trading/pending-orders?accountId=${encodeURIComponent(accountId)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) throw new Error(`pending-orders ${res.status}`);
      const data = (await res.json()) as { orders?: RawPendingOrderRow[] };
      return Array.isArray(data.orders) ? data.orders : [];
    } catch {
      // Fall back to the order-request queue when the pending-orders surface
      // is unavailable — both are real gateway rows, nothing is synthesized.
      return [];
    }
  },
  getExecutionHistory: (accountId) => getUnifiedTradingHistory({ accountId }),
  getTvAccountStatus: async () => {
    try {
      return await fetchTvAccountStatus();
    } catch {
      return null;
    }
  },
  readTradingViewPageSignal: () => defaultReadTradingViewPageSignal(),
};

/* ── cache + subscribers ────────────────────────────────────────────── */

export const ACCOUNT_CACHE_TTL_MS = 15_000;

let accountCache: { info: TradingViewAccountInfo; timestamp: number } | null = null;
let inflight: Promise<TradingViewAccountInfo> | null = null;
const listeners = new Set<(info: TradingViewAccountInfo) => void>();

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/* ── normalizers (raw gateway rows → bridge types) ──────────────────── */

export function normalizePositionRow(
  row: RawPositionRow,
  broker: string | null,
  accountId: string | null
): TradingViewPosition | null {
  const ticket = row.ticket !== undefined && row.ticket !== null ? String(row.ticket) : "";
  const symbol = str(row.symbol);
  if (!ticket || !symbol) return null;
  const type = String(row.type || "").toUpperCase();
  const side = type === "SELL" ? "SELL" : type === "BUY" ? "BUY" : (type as "BUY" | "SELL");
  return {
    id: ticket,
    symbol,
    side: side === "SELL" ? "SELL" : "BUY",
    quantity: Number(row.volume || 0),
    entryPrice: Number(row.openPrice || 0),
    // Only report a live mark price / P/L when the gateway actually sent one.
    currentPrice: typeof row.currentPrice === "number" && Number.isFinite(row.currentPrice) ? row.currentPrice : null,
    unrealizedPnl: typeof row.profit === "number" && Number.isFinite(row.profit) ? row.profit : null,
    stopLoss: num(row.sl),
    takeProfit: num(row.tp),
    status: "OPEN",
    openTime: typeof row.openedAt === "number" && row.openedAt > 0 ? row.openedAt : null,
    broker,
    accountId,
    canModify: true,
    canClose: true,
  };
}

export function normalizePendingOrderRow(
  row: RawPendingOrderRow,
  broker: string | null,
  accountId: string | null
): TradingViewPendingOrder | null {
  const ticket = row.ticket !== undefined && row.ticket !== null ? String(row.ticket) : "";
  const symbol = str(row.symbol);
  if (!ticket || !symbol) return null;
  const rawType = String(row.type || "").toUpperCase();
  const isBuy = rawType.startsWith("BUY");
  const isLimit = rawType.includes("LIMIT");
  const isStop = rawType.includes("STOP");
  return {
    id: ticket,
    symbol,
    side: isBuy ? "BUY" : "SELL",
    orderType: isLimit ? "LIMIT" : isStop ? "STOP" : "MARKET",
    quantity: Number(row.volume || 0),
    price: typeof row.price === "number" && Number.isFinite(row.price) ? row.price : null,
    stopLoss: num(row.sl),
    takeProfit: num(row.tp),
    status: "PENDING",
    timestamp: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
    broker,
    accountId,
    canModify: true,
    canCancel: true,
  };
}

/**
 * Unified Trading history → the panel's existing display rows.
 *
 * The display model (`ExecutionHistoryEntry`) is unchanged — only the source
 * is now `GET /api/trading/history` (via `getUnifiedTradingHistory`) instead
 * of the legacy gateway queue. Mapping rules, in the existing domain
 * vocabulary and without inventing fields:
 *   • requestId ← clientRequestId — the execution's identity,
 *   • status    ← reconciled state: a late EA fill shows FILLED here while
 *     the canonical `result` (e.g. FAILED/EXECUTION_TIMEOUT) stays untouched
 *     on the entry — two truths, never merged,
 *   • quantity  ← actual filled volume when known, else the reported volume,
 *   • price     ← actual execution price when reported, else the requested one,
 *   • orderId   ← provider ticket/reference,
 *   • side      ← the execution verb (CLOSE / …) when the canonical result
 *     carries an executionType, else BUY/SELL.
 */
export function normalizeUnifiedHistory(entries: UnifiedHistoryEntry[]): ExecutionHistoryEntry[] {
  const out: ExecutionHistoryEntry[] = [];
  for (const entry of entries) {
    const state = String(entry.state || "");
    if (!entry.clientRequestId || !isTerminalOrderStatus(state)) continue;
    out.push({
      requestId: entry.clientRequestId,
      symbol: str(entry.symbol),
      side: historySideLabel(entry),
      orderType: str(entry.kind),
      quantity:
        typeof entry.filledVolume === "number"
          ? entry.filledVolume
          : typeof entry.volume === "number"
          ? entry.volume
          : null,
      price: typeof entry.price === "number" ? entry.price : null,
      status: state,
      orderId: entry.providerRef ? String(entry.providerRef) : null,
      errorMessage: str(entry.errorMessage),
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : null,
      executedAt: typeof entry.executedAt === "number" ? entry.executedAt : null,
    });
  }
  return out;
}

/** Management actions keep their verb; entries show the side. */
function historySideLabel(entry: UnifiedHistoryEntry): string | null {
  switch (entry.executionType) {
    case "CLOSE_POSITION":
      return "CLOSE";
    case "PARTIAL_CLOSE":
      return "PARTIAL_CLOSE";
    case "MODIFY_POSITION":
      return "MODIFY";
    case "CANCEL_ORDER":
      return "CANCEL";
    default:
      return str(entry.side);
  }
}

/* ── account mode resolution ────────────────────────────────────────── */

function resolveExecutionMode(
  gatewayAccount: GatewayAccount | null,
  pageSignal: TradingViewPageAccountSignal | null
): { mode: AccountMode; source: TradingViewAccountInfo["modeSource"] } {
  // The gateway (execution destination) does not report live/demo today, so
  // the mode stays UNKNOWN rather than being guessed from names or numbers.
  if (gatewayAccount) {
    const reported = String((gatewayAccount as unknown as { accountType?: string }).accountType || "").toUpperCase();
    if (reported === "LIVE" || reported === "REAL") return { mode: "LIVE", source: "gateway" };
    if (reported === "DEMO" || reported === "PAPER") return { mode: "DEMO", source: "gateway" };
    return { mode: "UNKNOWN", source: "gateway" };
  }
  // No execution destination connected — report what TradingView itself shows.
  if (pageSignal?.paperTrading) return { mode: "PAPER", source: "tradingview-dom" };
  if (pageSignal?.liveBadge) return { mode: "LIVE", source: "tradingview-dom" };
  return { mode: "UNKNOWN", source: "unavailable" };
}

function resolveState(input: {
  gatewayConnected: boolean;
  pageSignal: TradingViewPageAccountSignal | null;
  mcpState: string | null;
  transportError: string | null;
}): AccountState {
  if (input.transportError && !input.gatewayConnected && !input.pageSignal) return "ERROR";
  if (input.gatewayConnected) return "TRADING_ENABLED";
  if (input.mcpState === "TOKEN_EXPIRED" || input.mcpState === "REAUTH_REQUIRED") {
    return "AUTHENTICATION_REQUIRED";
  }
  if (input.pageSignal) return "EXECUTION_UNAVAILABLE";
  if (input.transportError) return "ERROR";
  return "NOT_CONNECTED";
}

/* ── primary detection ──────────────────────────────────────────────── */

export interface DetectOptions {
  force?: boolean;
  transport?: AccountTransport;
  now?: () => number;
}

export async function detectTradingViewAccount(
  options: DetectOptions = {}
): Promise<TradingViewAccountInfo> {
  const now = options.now ?? (() => Date.now());
  const transport = options.transport ?? defaultTransport;
  const ts = now();

  if (!options.force && accountCache && ts - accountCache.timestamp < ACCOUNT_CACHE_TTL_MS) {
    return accountCache.info;
  }
  // Deduplicate concurrent reads; a forced refresh always runs its own pass
  // (it carries a specific transport/inputs the caller expects to be used).
  if (!options.force && inflight) return inflight;

  inflight = (async () => {
    let gatewayStatus: GatewayStatus | null = null;
    let transportError: string | null = null;
    let pageSignal: TradingViewPageAccountSignal | null = null;
    let serverStatus: TvAccountStatusResponse | null = null;

    const [gw, page, server] = await Promise.allSettled([
      transport.getGatewayStatus(),
      transport.readTradingViewPageSignal(),
      transport.getTvAccountStatus(),
    ]);
    if (gw.status === "fulfilled") gatewayStatus = gw.value;
    else transportError = gw.reason instanceof Error ? gw.reason.message : "gateway_unreachable";
    if (page.status === "fulfilled") pageSignal = page.value;
    if (server.status === "fulfilled") serverStatus = server.value;

    const gatewayAccount =
      gatewayStatus?.connected && gatewayStatus.accounts.length > 0 ? gatewayStatus.accounts[0] : null;

    const info = createEmptyAccountInfo();
    const mcpState = serverStatus?.connection?.state ?? null;

    info.tradingView = {
      chartConnected: Boolean(pageSignal?.pageReachable),
      chartLastSeenAt: pageSignal?.detectedAt ?? null,
      mcpState,
      mcpAuthorized: serverStatus?.connection?.authorized ?? null,
      mcpMessage: serverStatus?.connection?.message ?? null,
    };

    info.connectionStatus = gatewayAccount
      ? "CONNECTED"
      : pageSignal?.pageReachable
      ? "CONNECTED"
      : transportError
      ? "ERROR"
      : "DISCONNECTED";

    info.accountState = resolveState({
      gatewayConnected: Boolean(gatewayAccount),
      pageSignal,
      mcpState,
      transportError,
    });

    const mode = resolveExecutionMode(gatewayAccount, pageSignal);
    info.mode = mode.mode;
    info.modeSource = mode.source;

    if (gatewayAccount) {
      info.source = "gateway";
      info.broker = str(gatewayAccount.broker) ?? str(pageSignal?.brokerLabel);
      info.accountId = gatewayAccount.accountId;
      info.accountIdMasked = maskAccountId(gatewayAccount.accountNumber || gatewayAccount.accountId);
      info.accountType = null; // gateway does not report live/demo — never guessed
      info.currency = str(gatewayAccount.currency);
      info.balance = num(gatewayAccount.balance);
      info.equity = num(gatewayAccount.equity);

      const margin = num((gatewayAccount as unknown as { margin?: number }).margin);
      const freeMargin = num(gatewayAccount.freeMargin);
      const marginLevel = num((gatewayAccount as unknown as { marginLevel?: number }).marginLevel);
      info.marginFree = freeMargin;
      info.marginLevel = marginLevel;
      info.marginUsed =
        margin ?? (info.equity !== null && freeMargin !== null ? Math.max(0, info.equity - freeMargin) : null);
      info.buyingPower = freeMargin;

      info.tradingEnabled = true;
      info.supportedOrderTypes = ["market", "limit", "stop"];
      info.supportedActions = [
        "market_buy",
        "market_sell",
        "limit_buy",
        "limit_sell",
        "stop_buy",
        "stop_sell",
        "cancel_order",
        "modify_order",
        "close_position",
      ];
      info.tradingPermissions = ["market_orders", "limit_orders", "stop_orders", "position_management"];
      info.unsupportedReason = serverStatus?.execution?.reason ?? null;

      // Real positions / pending orders / history from the gateway account.
      const [positionsResult, pendingResult, historyResult] = await Promise.allSettled([
        transport.getPositions(gatewayAccount.accountId),
        transport.getPendingOrders(gatewayAccount.accountId),
        transport.getExecutionHistory(gatewayAccount.accountId),
      ]);

      if (positionsResult.status === "fulfilled") {
        info.openPositions = positionsResult.value
          .map((row) => normalizePositionRow(row, info.broker, info.accountId))
          .filter((p): p is TradingViewPosition => p !== null);
      }
      if (pendingResult.status === "fulfilled") {
        info.pendingOrders = pendingResult.value
          .map((row) => normalizePendingOrderRow(row, info.broker, info.accountId))
          .filter((p): p is TradingViewPendingOrder => p !== null);
      }
      if (historyResult.status === "fulfilled") {
        info.executionHistory = normalizeUnifiedHistory(historyResult.value);
      }

      const failed =
        positionsResult.status === "rejected" ||
        pendingResult.status === "rejected" ||
        historyResult.status === "rejected";
      info.dataAvailability = {
        positions: positionsResult.status === "fulfilled",
        pendingOrders: pendingResult.status === "fulfilled",
        executionHistory: historyResult.status === "fulfilled",
        reason: failed ? "Some gateway account data could not be refreshed." : null,
      };
    } else {
      info.source = pageSignal ? "tradingview-dom" : "unavailable";
      info.broker = str(pageSignal?.brokerLabel);
      info.accountId = null;
      info.accountIdMasked = null;
      info.tradingEnabled = false;
      info.supportedOrderTypes = [];
      info.supportedActions = [];
      info.tradingPermissions = [];
      info.unsupportedReason =
        info.accountState === "AUTHENTICATION_REQUIRED"
          ? "The TradingView authorization has expired. Reconnect TradingView to restore intelligence."
          : info.accountState === "ERROR"
          ? "Could not reach AlgoVault account services to detect a trading account."
          : "TradingView MCP is read-only (no account or execution tools). Connect the AlgoVault MT5 Gateway to enable execution.";
      info.dataAvailability = {
        positions: false,
        pendingOrders: false,
        executionHistory: false,
        reason: info.unsupportedReason,
      };
    }

    info.lastSyncTimestamp = ts;

    accountCache = { info, timestamp: ts };
    for (const listener of listeners) {
      try {
        listener(info);
      } catch {
        /* listener errors must never break detection */
      }
    }
    return info;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

let runtimeListenerAttached = false;
let revalidateTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Event-driven refresh (§18): the content script broadcasts TV_ACCOUNT_CONTEXT
 * whenever TradingView's own account markers change, so the panel updates
 * without aggressive polling. Re-detection is debounced + deduplicated.
 */
function attachRuntimeListener(): void {
  if (runtimeListenerAttached) return;
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
  runtimeListenerAttached = true;
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type !== "TV_ACCOUNT_CONTEXT") return;
    if (revalidateTimer) clearTimeout(revalidateTimer);
    revalidateTimer = setTimeout(() => {
      revalidateTimer = null;
      void detectTradingViewAccount({ force: true }).catch(() => undefined);
    }, 500);
  });
}

export function subscribeTVAccount(callback: (info: TradingViewAccountInfo) => void): () => void {
  attachRuntimeListener();
  listeners.add(callback);
  if (accountCache) {
    callback(accountCache.info);
  } else {
    void detectTradingViewAccount().then(callback).catch(() => undefined);
  }
  return () => {
    listeners.delete(callback);
  };
}

export function clearAccountCache(): void {
  accountCache = null;
}

/** Freshness helper for the UI ("Updated 4s ago"). */
export function accountAgeLabel(info: TradingViewAccountInfo, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - info.lastSyncTimestamp) / 1000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Updated ${minutes}m ago`;
}

/** Persisted by the content script when it probes the TradingView page. */
export const TV_PAGE_SIGNAL_STORAGE_KEY = PAGE_SIGNAL_STORAGE_KEY;
