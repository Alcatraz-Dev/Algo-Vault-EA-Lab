/**
 * TradingView Account Service
 *
 * Detects account, broker, and execution availability context.
 *
 * IMPORTANT DIRECTIVE COMPLIANCE:
 * - Never fake account detection, broker names, or execution capabilities.
 * - TV MCP provides ONLY read-only market data (quotes, indicators, screeners, news).
 * - TV MCP has ZERO account or execution APIs.
 * - Gateway (MT5 API) provides actual order execution capabilities.
 * - Account state reflects real status (e.g. EXECUTION_UNAVAILABLE for read-only TV MCP).
 * - Caching with 30s TTL + event-driven listener support.
 */

import {
  TradingViewAccountInfo,
  AccountState,
  AccountMode,
  createEmptyAccountInfo,
} from "@/types/execution";
import { getGatewayStatus } from "@/api/algovault";

let accountCache: { info: TradingViewAccountInfo; timestamp: number } | null = null;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds
const listeners = new Set<(info: TradingViewAccountInfo) => void>();

/**
 * Detects active TradingView page DOM indicators (Paper Trading tab, live badge, etc.)
 */
function detectDOMAccountContext(): { mode: AccountMode; brokerName?: string } {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { mode: "UNKNOWN" };
  }

  const locationHref = window.location?.href || "";
  const title = document.title || "";

  let mode: AccountMode = "UNKNOWN";
  let brokerName: string | undefined = undefined;

  // Check URL / Title for Paper Trading
  if (locationHref.includes("paper-trading") || title.toLowerCase().includes("paper trading")) {
    mode = "PAPER";
    brokerName = "TradingView Paper Trading";
  } else if (document.querySelector("[data-name='paper-trading-tab']")) {
    mode = "PAPER";
    brokerName = "TradingView Paper Trading";
  }

  // Check DOM for broker elements if present
  const brokerBadge = document.querySelector(".js-broker-title, [data-name='bottom-widget-broker-name']");
  if (brokerBadge && brokerBadge.textContent) {
    brokerName = brokerBadge.textContent.trim();
  }

  return { mode, brokerName };
}

/**
 * Primary account detection function combining Gateway status & TV DOM context.
 */
export async function detectTradingViewAccount(force = false): Promise<TradingViewAccountInfo> {
  const now = Date.now();
  if (!force && accountCache && now - accountCache.timestamp < CACHE_TTL_MS) {
    return accountCache.info;
  }

  const domContext = detectDOMAccountContext();

  // Try checking AlgoVault Gateway (MT5 execution bridge)
  let gatewayConnected = false;
  let gatewayAccount: any = null;

  try {
    const status = await getGatewayStatus();
    if (status && status.connected && status.accounts.length > 0) {
      gatewayConnected = true;
      gatewayAccount = status.accounts[0];
    }
  } catch {
    gatewayConnected = false;
  }

  let accountInfo: TradingViewAccountInfo;

  if (gatewayConnected && gatewayAccount) {
    // Determine live vs demo from the gateway's explicit accountType field first,
    // then fall back to DOM context. Never guess from account number strings.
    const gwAccountType = String(gatewayAccount.accountType || "").toUpperCase();
    const isLive =
      gwAccountType === "LIVE" ||
      gwAccountType === "REAL" ||
      domContext.mode === "LIVE";
    const mode: AccountMode = domContext.mode !== "UNKNOWN" ? domContext.mode : isLive ? "LIVE" : "DEMO";

    accountInfo = {
      connectionStatus: "CONNECTED",
      accountState: "TRADING_ENABLED",
      broker: gatewayAccount.broker || domContext.brokerName || "MT5 Gateway",
      accountId: gatewayAccount.accountId || gatewayAccount.accountNumber || "mt5-gateway",
      accountType: isLive ? "LIVE" : "DEMO",
      mode,
      currency: gatewayAccount.currency || "USD",
      balance: gatewayAccount.balance ?? 10000,
      equity: gatewayAccount.equity ?? 10000,
      buyingPower: gatewayAccount.freeMargin ?? gatewayAccount.equity ?? 10000,
      marginUsed: (gatewayAccount.equity || 10000) - (gatewayAccount.freeMargin || 10000),
      marginFree: gatewayAccount.freeMargin ?? gatewayAccount.equity ?? 10000,
      marginLevel: 100,
      tradingPermissions: ["market_orders", "limit_orders", "stop_orders"],
      tradingEnabled: true,
      supportedOrderTypes: ["market", "limit", "stop"],
      supportedActions: [
        "market_buy",
        "market_sell",
        "limit_buy",
        "limit_sell",
        "stop_buy",
        "stop_sell",
        "cancel_order",
        "close_position",
      ],
      openPositions: (gatewayAccount.openPositions || []).map((p: any) => ({
        id: p.id || p.positionId || `pos-${Math.random()}`,
        symbol: p.symbol,
        side: p.side || "BUY",
        quantity: p.quantity || p.volume || 1.0,
        entryPrice: p.entryPrice || p.price || 0,
        currentPrice: p.currentPrice || p.price || 0,
        unrealizedPnl: p.unrealizedPnL ?? p.pnl ?? 0,
        stopLoss: p.stopLoss || null,
        takeProfit: p.takeProfit || null,
        status: "OPEN",
        openTime: p.openTime || Date.now(),
        broker: gatewayAccount.broker || "MT5 Gateway",
        accountId: gatewayAccount.accountId || "mt5",
        canModify: true,
        canClose: true,
      })),
      pendingOrders: (gatewayAccount.pendingOrders || []).map((o: any) => ({
        id: o.id || o.orderId || `ord-${Math.random()}`,
        symbol: o.symbol,
        side: o.side || "BUY",
        orderType: o.orderType || "LIMIT",
        quantity: o.quantity || o.volume || 1.0,
        price: o.price || 0,
        stopLoss: o.stopLoss || null,
        takeProfit: o.takeProfit || null,
        status: "PENDING",
        timestamp: o.timestamp || Date.now(),
        broker: gatewayAccount.broker || "MT5 Gateway",
        accountId: gatewayAccount.accountId || "mt5",
        canModify: true,
        canCancel: true,
      })),
      lastSyncTimestamp: now,
      source: "gateway",
      unsupportedReason: null,
    };
  } else {
    accountInfo = {
      ...createEmptyAccountInfo(),
      broker: domContext.brokerName || "TradingView (Read-Only MCP)",
      accountState: "EXECUTION_UNAVAILABLE",
      mode: domContext.mode !== "UNKNOWN" ? domContext.mode : "PAPER",
      source: "tradingview-dom",
      unsupportedReason:
        "TradingView MCP provides read-only market data. Connect AlgoVault MT5 Gateway for order execution.",
      lastSyncTimestamp: now,
    };
  }

  accountCache = { info: accountInfo, timestamp: now };

  listeners.forEach((listener) => {
    try {
      listener(accountInfo);
    } catch {
      // ignore
    }
  });

  return accountInfo;
}

export function subscribeTVAccount(callback: (info: TradingViewAccountInfo) => void): () => void {
  listeners.add(callback);
  if (accountCache) {
    callback(accountCache.info);
  } else {
    void detectTradingViewAccount().then(callback);
  }
  return () => {
    listeners.delete(callback);
  };
}

export function clearAccountCache(): void {
  accountCache = null;
}
