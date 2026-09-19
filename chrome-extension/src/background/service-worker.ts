import { checkHealth, getGatewayStatus } from "@/api/algovault";
import { getAuthToken, getMarketCache, setMarketCache } from "@/storage/storage";
import type { ChartContext, TradingViewContext, ViewMode } from "@/types";
import { buildMarketContext } from "@/services/market-service";
import {
  enrichChartContext,
  buildStructuredContext,
  type EnrichedChartContext,
} from "@/services/chart-intelligence";

const EXT_PREFIX = "[AlgoVault SW]";
const MARKET_CACHE_TTL_MS = 5 * 60 * 1000;
const ENRICH_DEBOUNCE_MS = 450;

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let cachedChartContext: ChartContext | null = null;
let chartContextTimestamp = 0;
let latestEnriched: EnrichedChartContext | null = null;

let enrichmentTimer: ReturnType<typeof setTimeout> | null = null;
let enrichmentInFlight: Promise<void> | null = null;
let pendingAction: { view: ViewMode; context?: ChartContext | null } | null = null;

/* ── context menus ───────────────────────────────────────────────────── */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "algovault-analyze",
    title: "Analyze with AlgoVault",
    contexts: ["page", "selection"],
  });
  chrome.contextMenus.create({
    id: "algovault-strategy-lab",
    title: "Send to Strategy Lab",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "algovault-risk",
    title: "Calculate Risk",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "algovault-backtest",
    title: "Open in Backtest",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case "algovault-analyze":
      pendingAction = { view: "analysis", context: cachedChartContext };
      break;
    case "algovault-strategy-lab":
      pendingAction = { view: "strategy-intelligence", context: cachedChartContext };
      break;
    case "algovault-risk":
      pendingAction = { view: "risk", context: cachedChartContext };
      break;
    case "algovault-backtest":
      pendingAction = { view: "optimization-intelligence", context: cachedChartContext };
      break;
    default:
      return;
  }
  try {
    await chrome.action.openPopup();
  } catch (err) {
    console.warn(`${EXT_PREFIX} openPopup failed:`, err);
  }
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "REFRESH_CONTEXT" }).catch(() => {});
  }
});

/* ── enrichment ──────────────────────────────────────────────────────── */

function cacheKey(chart: ChartContext): string | null {
  if (!chart.marketSymbol || !chart.timeframe) return null;
  return `${chart.marketSymbol.toUpperCase()}|${chart.timeframe}`;
}

/**
 * Deliver a message to the popup/extension pages AND the TradingView content
 * scripts in every tab.
 *
 * Routing reality (Chrome MV3):
 *   - `chrome.runtime.sendMessage` from the service worker reaches extension
 *     pages (the popup) but NOT content scripts.
 *   - Content scripts are only reachable via `chrome.tabs.sendMessage`.
 * The live overlay is a content script, so both legs are needed.
 */
interface RuntimeBroadcast {
  type: string;
  payload?: unknown;
}

async function broadcastToAll(message: RuntimeBroadcast): Promise<void> {
  const msg = message as never;
  try {
    chrome.runtime.sendMessage(msg);
  } catch { /* no extension-page receivers */ }
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {
        /* tab has no content script (e.g. about:blank) */
      });
    }
  } catch { /* tabs API unavailable */ }
}

function scheduleEnrichment(): void {
  if (enrichmentTimer) clearTimeout(enrichmentTimer);
  enrichmentTimer = setTimeout(() => {
    enrichmentTimer = null;
    if (enrichmentInFlight) return;
    enrichmentInFlight = runEnrichment().finally(() => {
      enrichmentInFlight = null;
    });
  }, ENRICH_DEBOUNCE_MS);
}

async function runEnrichment(): Promise<void> {
  const chart = cachedChartContext;
  if (!chart || !chart.marketSymbol || !chart.timeframe) {
    // Nothing to enrich — broadcast the raw context so consumers stay in sync.
    if (chart) {
      latestEnriched = enrichChartContext(chart, null);
    }
    return;
  }

  const key = cacheKey(chart);
  let market: Awaited<ReturnType<typeof buildMarketContext>> | null = null;
  let fromCache = false;

  if (key) {
    const entry = await getMarketCache(key);
    if (entry && Date.now() - entry.timestamp < MARKET_CACHE_TTL_MS &&
        (entry.marketContext as { status?: string } | null)?.status === "ready") {
      market = entry.marketContext as Awaited<ReturnType<typeof buildMarketContext>>;
      fromCache = true;
    }
  }

  if (!market) {
    try {
      market = await buildMarketContext(chart.marketSymbol, chart.timeframe, { chart });
      if (key && market.status === "ready") {
        await setMarketCache(key, market);
      }
    } catch (err) {
      console.warn(`${EXT_PREFIX} Enrichment market fetch failed:`, err);
      market = null;
    }
  }

  const enriched = enrichChartContext(chart, market);
  latestEnriched = enriched;

  try {
    await chrome.storage.local.set({ chartIntel: enriched });
  } catch { /* storage may be unavailable */ }

  console.log(
    `${EXT_PREFIX} MARKET_CONTEXT_READY`,
    `${enriched.chart.marketSymbol || enriched.chart.symbol} ${enriched.chart.timeframe}`,
    `cache=${fromCache} price=${enriched.priceValidation.marketPrice ?? "n/a"} setup=${enriched.setup.direction} (${enriched.setup.confidence})`
  );

  try {
    await broadcastToAll({ type: "MARKET_CONTEXT_READY", payload: enriched });
  } catch { /* no receivers */ }
}

async function buildEnrichedFor(chart: ChartContext, force = false): Promise<EnrichedChartContext> {
  if (!chart.marketSymbol || !chart.timeframe) {
    return enrichChartContext(chart, null);
  }

  const key = cacheKey(chart);
  let market: Awaited<ReturnType<typeof buildMarketContext>> | null = null;
  if (!force && key) {
    const entry = await getMarketCache(key);
    if (entry && Date.now() - entry.timestamp < MARKET_CACHE_TTL_MS &&
        (entry.marketContext as { status?: string } | null)?.status === "ready") {
      market = entry.marketContext as Awaited<ReturnType<typeof buildMarketContext>>;
    }
  }

  if (!market) {
    try {
      market = await buildMarketContext(chart.marketSymbol, chart.timeframe, { chart });
      if (key && market.status === "ready") {
        await setMarketCache(key, market);
      }
    } catch { market = null; }
  }

  const enriched = enrichChartContext(chart, market);
  latestEnriched = enriched;
  try {
    await chrome.storage.local.set({ chartIntel: enriched });
  } catch { /* ignore */ }
  return enriched;
}

/* ── message handling ────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "GET_HEALTH":
      checkHealth()
        .then((ok) => sendResponse({ healthy: ok }))
        .catch(() => sendResponse({ healthy: false }));
      return true;

    case "GET_GATEWAY_STATUS":
      getAuthToken()
        .then((token) => {
          if (!token) return sendResponse({ connected: false });
          return getGatewayStatus()
            .then((status) => sendResponse(status))
            .catch(() => sendResponse({ connected: false }));
        })
        .catch(() => sendResponse({ connected: false }));
      return true;

    case "TRADINGVIEW_CONTEXT_UPDATE":
      if (message.payload && typeof message.payload === "object") {
        cachedChartContext = message.payload as ChartContext;
        chartContextTimestamp = Date.now();
        try {
          chrome.storage.local.set({
            chartContext: cachedChartContext,
            chartContextTimestamp,
            tradingViewContext: cachedChartContext,
            tradingViewContextTimestamp: Date.now(),
          });
        } catch { /* storage may be unavailable */ }
        // Rebroadcast the RAW context to the popup and the live overlay so
        // symbol·timeframe renders instantly; MARKET_CONTEXT_READY enriches
        // it with market data once available.
        broadcastToAll({
          type: "TRADINGVIEW_CONTEXT_UPDATE",
          payload: cachedChartContext,
        });
        scheduleEnrichment();
      }
      sendResponse({ ok: true });
      return false;

    case "GET_CONTEXT":
      sendResponse({ context: cachedChartContext, timestamp: chartContextTimestamp });
      return false;

    case "SET_CHART_CONTEXT":
      if (message.payload && typeof message.payload === "object") {
        const incoming = message.payload as Partial<ChartContext>;
        cachedChartContext = {
          ...(cachedChartContext || {}),
          ...incoming,
          isTradingView: false,
          source: "manual",
          manualOverride: true,
          timestamp: Date.now(),
        } as ChartContext;
        chartContextTimestamp = Date.now();
        try {
          chrome.storage.local.set({
            chartContext: cachedChartContext,
            chartContextTimestamp,
          });
        } catch { /* ignore */ }
        scheduleEnrichment();
      }
      sendResponse({ success: true });
      return false;

    case "GET_CHART_CONTEXT":
      sendResponse({
        context: cachedChartContext,
        timestamp: chartContextTimestamp,
        enriched: latestEnriched,
      });
      return false;

    case "GET_AI_READY_CONTEXT":
      handleGetAiReadyContext(message).then(sendResponse).catch((err) =>
        sendResponse({ error: err instanceof Error ? err.message : "Failed to build AI context", chart: cachedChartContext })
      );
      return true;

    case "GET_PENDING_ACTION":
      sendResponse({ action: pendingAction });
      pendingAction = null;
      return false;

    case "ANALYZE_CHART":
    case "CREATE_SIGNAL":
    case "OPEN_STRATEGY_LAB":
    case "CALCULATE_RISK":
    case "OPEN_BACKTEST":
    case "OPEN_AI_COPILOT":
      handleActionMessage(message);
      sendResponse({ ok: true });
      return false;

    case "OPEN_PAGE":
      if (message.url) {
        chrome.tabs.create({ url: message.url as string });
      }
      sendResponse({ success: true });
      return false;

    case "NOTIFY":
      if (message.title && message.message) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.svg"),
          title: message.title as string,
          message: message.message as string,
        });
      }
      sendResponse({ success: true });
      return false;

    default:
      return false;
  }
});

async function handleGetAiReadyContext(message: { payload?: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const requested = (message.payload?.chart as ChartContext | undefined) ?? null;
  const force = Boolean(message.payload?.force);
  const chart = requested && requested.symbol ? requested : cachedChartContext;

  if (!chart || !chart.symbol) {
    return {
      chart: null,
      enriched: null,
      structuredContext: null,
      error: "No active chart. Open a chart on TradingView first.",
    };
  }

  let enriched = latestEnriched;
  if (force || !enriched || enriched.chart.symbol !== chart.symbol || enriched.chart.timeframe !== chart.timeframe) {
    enriched = await buildEnrichedFor(chart, force);
  }

  if (!enriched?.market && cachedChartContext?.status !== "active") {
    enriched = await buildEnrichedFor(chart, true);
  }

  return {
    chart,
    enriched,
    structuredContext: enriched ? buildStructuredContext(enriched) : null,
  };
}

function handleActionMessage(message: { type: string; payload?: Record<string, unknown> }): void {
  const context = (message.payload as ChartContext | undefined) ?? cachedChartContext;
  const maps: Record<string, ViewMode> = {
    ANALYZE_CHART: "analysis",
    CREATE_SIGNAL: "signal",
    OPEN_STRATEGY_LAB: "strategy-intelligence",
    CALCULATE_RISK: "risk",
    OPEN_BACKTEST: "optimization-intelligence",
    OPEN_AI_COPILOT: "ai-copilot",
  };
  pendingAction = { view: maps[message.type] ?? "main", context };
  try {
    chrome.action.openPopup();
  } catch (err) {
    console.warn(`${EXT_PREFIX} openPopup failed:`, err);
  }
}

/* ── storage sync ────────────────────────────────────────────────────── */

chrome.storage.onChanged.addListener((changes) => {
  if (changes.chartContext && changes.chartContext.newValue) {
    cachedChartContext = changes.chartContext.newValue as ChartContext;
  }
  if (changes.chartContextTimestamp && changes.chartContextTimestamp.newValue) {
    chartContextTimestamp = changes.chartContextTimestamp.newValue as number;
  }
});

async function loadCachedState(): Promise<void> {
  try {
    const data = await chrome.storage.local.get(["chartContext", "chartContextTimestamp", "chartIntel"]);
    if (data.chartContext) {
      cachedChartContext = data.chartContext as ChartContext;
    }
    if (data.chartContextTimestamp) {
      chartContextTimestamp = data.chartContextTimestamp as number;
    }
    if (data.chartIntel) {
      latestEnriched = data.chartIntel as EnrichedChartContext;
    }
  } catch { /* storage may be unavailable */ }
}

/* ── health check ────────────────────────────────────────────────────── */

async function startHealthCheck() {
  if (healthCheckInterval) clearInterval(healthCheckInterval);

  const check = async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        chrome.action.setBadgeText({ text: "" });
        return;
      }
      const healthy = await checkHealth();
      chrome.action.setBadgeBackgroundColor({
        color: healthy ? "#10b981" : "#f43f5e",
      });
      chrome.action.setBadgeText({ text: healthy ? "" : "!" });
    } catch {
      chrome.action.setBadgeText({ text: "" });
    }
  };

  await check();
  healthCheckInterval = setInterval(check, 60000);
}

chrome.alarms.create("health-check", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "health-check") {
    startHealthCheck();
  }
});

/* ── boot ────────────────────────────────────────────────────────────── */

loadCachedState().then(() => {
  if (cachedChartContext?.symbol) {
    scheduleEnrichment();
  }
});