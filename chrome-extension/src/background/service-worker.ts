import { checkHealth, getGatewayStatus } from "@/api/algovault";
import { getAuthToken, getMarketCache, setMarketCache, getCopilotPrefs, getServerInstallId, setServerInstallId } from "@/storage/storage";
import type { ChartContext, TradingViewContext, ViewMode } from "@/types";
import { buildMarketContext } from "@/services/market-service";
import { generateResearch } from "@/services/research-service";
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
let lastAutoAnalyzedSymbol: string | null = null;

/* TradingView tab tracking — the popup can't read the chart itself, so the
 * SW continuously tracks which tab is the "active" TradingView chart and
 * proxies fresh context requests to it. Refreshes are scoped to the focused
 * TV tab (not any tab) so multiple charts stay independent. */
let activeTvTabId: number | null = null;
let activeTvWindowId: number | null = null;
let lastTvHeartbeat: { tabId: number; at: number } | null = null;

let enrichmentTimer: ReturnType<typeof setTimeout> | null = null;
let enrichmentInFlight: Promise<void> | null = null;
let pendingAction: { view: ViewMode; context?: ChartContext | null } | null = null;

/* ── active TradingView tab tracking ─────────────────────────────────── */

function isTradingViewUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\/(?:[a-z0-9-]+\.)?tradingview\.com\//i.test(url);
}

async function refreshActiveTvTab(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const hit = tabs.find((t) => t.id != null && isTradingViewUrl(t.url));
    if (hit?.id != null) {
      activeTvTabId = hit.id;
      activeTvWindowId = hit.windowId ?? null;
      return;
    }
  } catch { /* tabs API unavailable */ }
  // Fall back to ANY focused TradingView tab (covers the case where the
  // popup's window stole focus when it opened — the chart tab is still
  // semantically the "active" one).
  try {
    const tabs = await chrome.tabs.query({ url: "*://*.tradingview.com/*" });
    const focused = tabs.find((t) => t.id != null);
    if (focused?.id != null) {
      activeTvTabId = focused.id;
      activeTvWindowId = focused.windowId ?? null;
    }
  } catch { /* ignore */ }
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  activeTvTabId = tabId;
  activeTvWindowId = windowId;
});

chrome.windows.onFocusChanged.addListener(() => {
  void refreshActiveTvTab();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTvTabId) {
    activeTvTabId = null;
    activeTvWindowId = null;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && isTradingViewUrl(changeInfo.url)) {
    activeTvTabId = tabId;
    activeTvWindowId = tab.windowId ?? null;
  }
});

/* Kick the initial lookup as soon as the SW spins up. */
void refreshActiveTvTab();

/* ── context menus ───────────────────────────────────────────────────── */

chrome.runtime.onInstalled.addListener(() => {
  // Remove stale entries first — onInstalled also fires on update/reload and
  // duplicate ids would otherwise log "Cannot create item with same id".
  chrome.contextMenus.removeAll(() => {
    const create = (id: string, title: string, contexts: chrome.contextMenus.ContextType[]) =>
      chrome.contextMenus.create({ id, title, contexts }, () => void chrome.runtime.lastError);
    create("algovault-analyze", "Analyze with AlgoVault", ["page", "selection"]);
    create("algovault-strategy-lab", "Send to Strategy Lab", ["page"]);
    create("algovault-risk", "Calculate Risk", ["page"]);
    create("algovault-backtest", "Open in Backtest", ["page"]);
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

  // Auto-analysis: pre-generate the quick research note when the chart symbol
  // changes (only when the user opted in; cached reports are reused).
  try {
    const prefs = await getCopilotPrefs();
    const symbol = enriched.chart.symbol;
    if (prefs.autoAnalyzeOnSwitch && symbol && symbol !== lastAutoAnalyzedSymbol) {
      lastAutoAnalyzedSymbol = symbol;
      void generateResearch({
        symbol,
        timeframe: enriched.chart.timeframe || "H1",
        kind: "quick",
        structuredContext: buildStructuredContext(enriched),
        contextObject: enriched,
        force: false,
      }).catch(() => { /* research is optional */ });
    }
  } catch { /* prefs may be unavailable */ }
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

/* ── message handling ────────────────────────────────────────────────── *//* ── side panel ─────────────────────────────────────────────────────── */

// Open the side panel when the toolbar icon is clicked. The popup stays the
// default action surface (manifest `default_popup`); this listener only runs
// when the popup is suppressed programmatically below.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err: unknown) => console.warn(`${EXT_PREFIX} setPanelBehavior failed:`, err));

/*
 * Continuously track the last focused NORMAL window so OPEN_SIDE_PANEL can
 * call chrome.sidePanel.open() SYNCHRONOUSLY with a concrete window id.
 * chrome.sidePanel.open() must run inside a live user gesture: the gesture
 * survives the message hop from a popup click, but does NOT survive promise
 * boundaries — an await-before-open (e.g. windows.getLastFocused) reliably
 * fails with "may only be called in response to a user gesture".
 */
let lastFocusedWindowId: number | null = null;

function trackFocusedWindow(): void {
  try {
    chrome.windows.getLastFocused((win) => {
      if (win?.id != null && win.type === "normal") lastFocusedWindowId = win.id;
    });
  } catch { /* windows API unavailable */ }
}

trackFocusedWindow();
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // focus left Chrome
  try {
    chrome.windows.get(windowId, (win) => {
      if (win?.id != null && win.type === "normal") lastFocusedWindowId = win.id;
    });
  } catch { /* window gone */ }
});
chrome.runtime.onStartup.addListener(trackFocusedWindow);

/**
 * Synchronously-openable side-panel target, or null when unknown. Callers
 * MUST NOT pass WINDOW_ID_CURRENT/-2 — sidePanel.open() rejects sentinels.
 */
function sidePanelTargetWindowId(requested?: number, senderWindowId?: number): number | null {
  if (requested != null && requested !== chrome.windows.WINDOW_ID_CURRENT && requested !== chrome.windows.WINDOW_ID_NONE) {
    return requested;
  }
  if (senderWindowId != null && senderWindowId !== chrome.windows.WINDOW_ID_NONE) {
    return senderWindowId;
  }
  return lastFocusedWindowId;
}

/** Last-resort UX when open() fails: a notification, never a dead button. */
function notifySidePanelFailure(err: unknown): void {
  console.warn(`${EXT_PREFIX} sidePanel.open failed:`, err);
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "AlgoVault",
      message: "Could not open the side panel automatically. Right-click the AlgoVault icon → \u201cOpen side panel\u201d.",
    });
  } catch { /* notifications may be denied */ }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "OPEN_SIDE_PANEL": {
      // User-gesture critical: chrome.sidePanel.open() must be called
      // synchronously in this handler body — awaiting anything first
      // invalidates the gesture. All window resolution below is cached,
      // synchronous state.
      const target = sidePanelTargetWindowId(
        message.windowId as number | undefined,
        _sender?.tab?.windowId
      );

      if (target != null) {
        try {
          chrome.sidePanel.open({ windowId: target }).catch((err: unknown) => {
            notifySidePanelFailure(err);
          });
        } catch (err) {
          notifySidePanelFailure(err);
        }
      } else {
        // No trusted window id (rare: SW restarted + no focus event yet).
        // Resolve WITHOUT the gesture and surface a fallback notification.
        void chrome.windows.getLastFocused().then((win) => {
          if (win?.id != null && win.id !== chrome.windows.WINDOW_ID_NONE) {
            return chrome.sidePanel.open({ windowId: win.id }).catch(notifySidePanelFailure);
          }
          notifySidePanelFailure("no window id available");
          return undefined;
        }).catch(notifySidePanelFailure);
      }
      sendResponse({ ok: true, windowId: target });
      return false;
    }

    case "TOGGLE_FLOATING_PANEL": {
      // Toggle the draggable floating copilot panel in TradingView tabs. The
      // caller (popup Side Panel button) falls back to the docked side panel
      // when no tab acknowledges, so reply with the delivered count.
      (async () => {
        const tabs = await chrome.tabs.query({ url: "*://*.tradingview.com/*" });
        let delivered = 0;
        for (const tab of tabs) {
          if (tab.id == null) continue;
          try {
            const resp = await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_FLOATING_PANEL" });
            if (resp?.ok) delivered++;
          } catch { /* tab has no floating-panel script */ }
        }
        sendResponse({ ok: delivered > 0, delivered });
      })();
      return true;
    }

    case "RUN_CHART_COMMAND": {
      // Relay the command to TradingView tabs — content scripts are only
      // reachable via chrome.tabs.sendMessage.
      (async () => {
        const payload = (message.payload ?? {}) as Record<string, unknown>;
        const tabs = await chrome.tabs.query({ url: "*://*.tradingview.com/*" });
        if (tabs.length === 0) {
          broadcastToAll({
            type: "CHART_COMMAND_RESULT",
            payload: { command: payload.command, ok: false, message: "No TradingView tab open", at: Date.now() },
          });
          return;
        }
        for (const tab of tabs) {
          if (tab.id == null) continue;
          chrome.tabs.sendMessage(tab.id, { type: "RUN_CHART_COMMAND", payload }).catch(() => {});
        }
      })();
      sendResponse({ ok: true, message: "Relayed to TradingView" });
      return false;
    }

    case "CHART_COMMAND_RESULT":
      // Rebroadcast results so every extension surface sees them.
      broadcastToAll({ type: "CHART_COMMAND_RESULT", payload: message.payload });
      sendResponse({ ok: true });
      return false;

    case "SET_SMART_DRAWINGS":
    case "CLEAR_SMART_DRAWINGS":
      // Relay drawing payloads from extension pages to TradingView tabs.
      (async () => {
        const tabs = await chrome.tabs.query({ url: "*://*.tradingview.com/*" });
        for (const tab of tabs) {
          if (tab.id == null) continue;
          chrome.tabs.sendMessage(tab.id, { type: message.type, payload: message.payload }).catch(() => {});
        }
      })();
      sendResponse({ ok: true });
      return false;

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

    case "TV_HEARTBEAT": {
      // The content script pings the SW periodically so the popup can tell
      // whether a TV tab is actually alive (vs just cached). Track the
      // sender so subsequent refreshes know which tab to query.
      const sender = (message as { sender?: chrome.runtime.MessageSender }).sender;
      if (sender?.tab?.id != null) {
        activeTvTabId = sender.tab.id;
        activeTvWindowId = sender.tab.windowId ?? null;
        lastTvHeartbeat = { tabId: sender.tab.id, at: Date.now() };
      }
      sendResponse({
        ok: true,
        activeTabId: activeTvTabId,
        heartbeatAt: lastTvHeartbeat?.at ?? 0,
      });
      return false;
    }

    case "GET_ACTIVE_TV_TAB": {
      // The popup asks "is there a live TV chart I can sync to?" — returns
      // the active TV tab's id + heartbeat age so the UI can show whether
      // detection is fresh or stale.
      void refreshActiveTvTab();
      const ageMs = lastTvHeartbeat ? Date.now() - lastTvHeartbeat.at : null;
      sendResponse({
        ok: true,
        activeTabId: activeTvTabId,
        activeWindowId: activeTvWindowId,
        lastHeartbeatAt: lastTvHeartbeat?.at ?? 0,
        ageMs,
        context: cachedChartContext,
        contextTimestamp: chartContextTimestamp,
      });
      return false;
    }

    case "REFRESH_FROM_ACTIVE_TV": {
      // Force the active TV tab's content script to re-detect and reply
      // with a fresh ChartContext. We resolve once that arrives (or fall
      // back to whatever the SW has cached if no tab responds).
      (async () => {
        try {
          await refreshActiveTvTab();
          const targetId = activeTvTabId;
          if (targetId == null) {
            sendResponse({
              ok: false,
              reason: "no-tv-tab",
              context: cachedChartContext,
              contextTimestamp: chartContextTimestamp,
            });
            return;
          }
          try {
            const resp = await chrome.tabs.sendMessage(targetId, { type: "REFRESH_CONTEXT" });
            const context = (resp as { context?: ChartContext } | undefined)?.context;
            if (context) {
              cachedChartContext = context;
              chartContextTimestamp = Date.now();
              try {
                chrome.storage.local.set({
                  chartContext: cachedChartContext,
                  chartContextTimestamp,
                  tradingViewContext: cachedChartContext,
                  tradingViewContextTimestamp: Date.now(),
                });
              } catch { /* ignore */ }
              scheduleEnrichment();
              sendResponse({ ok: true, context: cachedChartContext, contextTimestamp: chartContextTimestamp, tabId: targetId });
              return;
            }
          } catch (err) {
            console.warn(`${EXT_PREFIX} REFRESH_FROM_ACTIVE_TV:`, err);
          }
          // Tab didn't respond — fall back to whatever we already have.
          sendResponse({
            ok: true,
            cached: true,
            context: cachedChartContext,
            contextTimestamp: chartContextTimestamp,
            tabId: targetId,
          });
        } catch (err) {
          sendResponse({ ok: false, reason: err instanceof Error ? err.message : "unknown" });
        }
      })();
      return true; // async response
    }

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
      // NOTE: not cleared here on purpose. Multiple surfaces (popup, side
      // panel) ask for the pending action when they (re)mount, and a stale
      // action is harmless — the popup clears it via CLEAR_PENDING_ACTION
      // once it actually navigates on the EXTENSION_VIEW_REQUESTED broadcast.
      return false;

    case "CLEAR_PENDING_ACTION":
      pendingAction = null;
      sendResponse({ ok: true });
      return false;

    case "OPEN_EXTENSION_VIEW": {
      // Overlay / content-script buttons can't open the popup themselves
      // (chrome.action.openPopup() is gesture-gated and silently blocked
      // from most contexts), so: park the view request, broadcast it, and
      // let whichever surface is open navigate. If NO surface ACKs quickly,
      // fall back to a notification pointing at the toolbar icon — the
      // parked action then resumes the view on the next popup open.
      const view = String(message.view ?? "main");
      pendingAction = { view: view as ViewMode, context: cachedChartContext };
      try {
        // Works on Chrome versions/modes that allow it; a no-op otherwise.
        void chrome.action.openPopup?.();
      } catch { /* gesture not available — broadcast path below */ }
      broadcastToAll({
        type: "EXTENSION_VIEW_REQUESTED",
        payload: { view, alert: message.alert ?? null },
      });
      armViewAckFallback(view);
      sendResponse({ ok: true });
      return false;
    }

    case "ACK_EXTENSION_VIEW":
      disarmViewAckFallback();
      sendResponse({ ok: true });
      return false;

    case "AUTO_CREATE_ALERT": {
      // One-tap alert from the overlay: fires at the current price.
      const p = (message.payload ?? {}) as { symbol?: string; price?: number; timeframe?: string };
      if (p.symbol && typeof p.price === "number") {
        void (async () => {
          try {
            const { createAlert } = await import("../api/alerts");
            await createAlert({
              symbol: p.symbol as string,
              type: "price_above",
              targetPrice: p.price,
              timeframe: p.timeframe || "H1",
              message: `Quick alert @ ${p.price} (${p.timeframe || "H1"})`,
            });
            chrome.notifications.create({
              type: "basic",
              iconUrl: chrome.runtime.getURL("icons/icon128.png"),
              title: "Alert created",
              message: `${p.symbol} @ ${p.price} — you'll be notified.`,
            });
          } catch (err) {
            console.warn(`${EXT_PREFIX} quick alert failed:`, err);
            try {
              chrome.notifications.create({
                type: "basic",
                iconUrl: chrome.runtime.getURL("icons/icon128.png"),
                title: "Alert failed",
                message: err instanceof Error ? err.message : "Could not create the alert.",
              });
            } catch { /* notifications may be denied */ }
            broadcastToAll({ type: "EXTENSION_ALERT_RESULT", payload: { ok: false, error: err instanceof Error ? err.message : "failed" } });
            return;
          }
          broadcastToAll({ type: "EXTENSION_ALERT_RESULT", payload: { ok: true, symbol: p.symbol, price: p.price } });
        })();
      } else {
        // No market data loaded — send the user to the signals tab instead
        // of failing silently.
        pendingAction = { view: "signals-list", context: cachedChartContext };
        broadcastToAll({ type: "EXTENSION_VIEW_REQUESTED", payload: { view: "signals-list", alert: null } });
      }
      sendResponse({ ok: true });
      return false;
    }

    case "ANALYZE_CHART":
    case "CREATE_SIGNAL":
    case "OPEN_STRATEGY_LAB":
    case "CALCULATE_RISK":
    case "OPEN_BACKTEST":
    case "OPEN_AI_COPILOT":
      handleActionMessage(message);
      armViewAckFallback(String((message as { type: string }).type));
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
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: message.title as string,
          message: message.message as string,
        });
      }
      sendResponse({ success: true });
      return false;

    case "CREATE_QUICK_ALERT": {
      // One-tap alert from the overlay: fires at the current price.
      const p = (message.payload ?? {}) as { symbol?: string; price?: number; timeframe?: string };
      if (p.symbol && typeof p.price === "number") {
        void (async () => {
          try {
            const { createAlert } = await import("../api/alerts");
            await createAlert({
              symbol: p.symbol as string,
              type: "price_above",
              targetPrice: p.price,
              timeframe: p.timeframe || "H1",
              message: `Quick alert @ ${p.price} (${p.timeframe || "H1"})`,
            });
            chrome.notifications.create({
              type: "basic",
              iconUrl: chrome.runtime.getURL("icons/icon128.png"),
              title: "Alert created",
              message: `${p.symbol} @ ${p.price} — you'll be notified.`,
            });
          } catch (err) {
            console.warn(`${EXT_PREFIX} quick alert failed:`, err);
          }
        })();
      }
      sendResponse({ ok: true });
      return false;
    }

    default:
      return false;
  }
});

/* ── durable install identity (site ↔ extension binding) ─────────────── */

const INSTALL_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

// The AlgoVault website (externally_connectable) mints and announces the
// install id that server-side quotas are keyed by. Because the site's
// localStorage survives extension removal, the free daily signals quota does
// too — even across delete + reinstall.
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string } | null)?.type;
  const installId = (message as { installId?: string } | null)?.installId;
  if (type === "STORE_INSTALL_ID") {
    if (typeof installId === "string" && INSTALL_ID_PATTERN.test(installId)) {
      void setServerInstallId(installId);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: "Invalid installId" });
    }
    return false;
  }
  if (type === "GET_INSTALL_ID") {
    void getServerInstallId().then((id) => sendResponse({ ok: true, installId: id }));
    return true;
  }
  return false;
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

/* ── view-request ack watchdog ───────────────────────────────────────── */

let viewAckTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * If no extension surface acknowledged the view request within 600 ms,
 * nothing is open — nudge the user toward the toolbar icon (the parked
 * pendingAction resumes the requested view the moment the popup opens).
 */
function armViewAckFallback(view: string): void {
  disarmViewAckFallback();
  viewAckTimer = setTimeout(() => {
    viewAckTimer = null;
    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "AlgoVault",
        message: "Click the AlgoVault toolbar icon to open it.",
      });
    } catch { /* notifications may be denied */ }
  }, 600);
}

function disarmViewAckFallback(): void {
  if (viewAckTimer != null) {
    clearTimeout(viewAckTimer);
    viewAckTimer = null;
  }
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
  const view = maps[message.type] ?? "main";
  pendingAction = { view, context };
  // chrome.action.openPopup() is silently blocked outside a real toolbar
  // gesture, so broadcast instead — the popup/side panel navigates when
  // alive, and parks the action for the next open otherwise.
  broadcastToAll({ type: "EXTENSION_VIEW_REQUESTED", payload: { view, alert: null } });
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