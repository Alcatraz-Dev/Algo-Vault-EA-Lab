import React, { useState, useEffect, useCallback, useMemo } from "react";
import { checkHealth, getGatewayStatus, openStrategyLab, runBacktestFromExtension } from "@/api/algovault";
import { getAuthToken, getCachedContext, getUser } from "@/storage/storage";
import type { TradingViewContext, ViewMode } from "@/types";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import { resolveMarketSymbol, classifyMarket } from "@/utils/symbols";
import { Header } from "./components/Header";
import { MainView } from "./components/MainView";
import { AnalysisView } from "./components/AnalysisView";
import { AICopilotView } from "./components/AICopilotView";
import { RiskView } from "./components/RiskView";
import { SignalView } from "./components/SignalView";
import { ExecuteView } from "./components/ExecuteView";
import { QuickOrderView } from "./components/QuickOrderView";
import { SignalsListView } from "./components/SignalsListView";
import { SettingsView } from "./components/SettingsView";
import { LoginView } from "./components/LoginView";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isHealthy, setIsHealthy] = useState(false);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [context, setContext] = useState<TradingViewContext | null>(null);
  const [enriched, setEnriched] = useState<EnrichedChartContext | null>(null);
  const [view, setView] = useState<ViewMode>("main");
  const [offlineNotice, setOfflineNotice] = useState(false);

  /**
   * Canonical chart context handed to every feature: the enriched chart
   * (browser detection + normalization + backfilled indicators) when
   * available, otherwise the raw browser context.
   */
  const effectiveContext = useMemo<TradingViewContext | null>(() => {
    if (enriched?.chart && (enriched.chart.symbol || enriched.chart.marketSymbol)) {
      return enriched.chart as TradingViewContext;
    }
    return context;
  }, [enriched, context]);

  const activeSymbol = effectiveContext?.symbol || null;
  const activeTimeframe = effectiveContext?.timeframe || null;
  const activePrice = enriched?.market?.currentPrice ?? effectiveContext?.price ?? null;

  useEffect(() => {
    const init = async () => {
      const INIT_TIMEOUT = 6000;
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, INIT_TIMEOUT));
      const initPromise = (async () => {
        try {
          const token = await getAuthToken();
          setIsAuthenticated(!!token);
          const healthy = await checkHealth();
          setIsHealthy(healthy);
          setOfflineNotice(!healthy);
          if (token) {
            try {
              const gw = await getGatewayStatus();
              setGatewayConnected(gw.connected);
            } catch { setGatewayConnected(false); }
            try {
              const u = await getUser();
              setUser(u);
            } catch { setUser(null); }
          }
          const cached = await getCachedContext();
          if (cached.context?.symbol) {
            setContext(cached.context);
          }
          // Canonical enriched context from the service worker.
          try {
            chrome.runtime.sendMessage({ type: "GET_AI_READY_CONTEXT" }, (response) => {
              if (response?.enriched) {
                setEnriched(response.enriched as EnrichedChartContext);
                if (response.chart?.symbol) setContext(response.chart as TradingViewContext);
              }
            });
          } catch { /* SW may be asleep */ }
          // Overlay / context-menu navigation, if any.
          try {
            chrome.runtime.sendMessage({ type: "GET_PENDING_ACTION" }, (response) => {
              if (response?.action?.view) setView(response.action.view as ViewMode);
            });
          } catch { /* ignore */ }
        } catch { /* ignore */ }
      })();
      await Promise.race([initPromise, timeoutPromise]);
      setIsLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    const listener = (message: { type: string; payload?: unknown }) => {
      if (message.type === "TRADINGVIEW_CONTEXT_UPDATE" && message.payload) {
        setContext(message.payload as TradingViewContext);
      }
      if (message.type === "MARKET_CONTEXT_READY" && message.payload) {
        setEnriched(message.payload as EnrichedChartContext);
      }
    };
    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, []);

  const handleAuth = useCallback(() => { setIsAuthenticated(true); setView("main"); }, []);
  const handleLogout = useCallback(() => { setIsAuthenticated(false); setUser(null); setView("main"); }, []);

  /** Tell the service worker that the user set a manual chart identity so it
   *  can (re)enrich market data for that symbol. */
  const notifyManualContext = useCallback((next: TradingViewContext) => {
    try {
      chrome.runtime.sendMessage({
        type: "SET_CHART_CONTEXT",
        payload: {
          symbol: next.symbol,
          exchange: next.exchange,
          timeframe: next.timeframe,
          rawSymbol: next.rawSymbol ?? next.symbol,
          marketSymbol: next.marketSymbol ?? next.symbol,
          market: next.market,
          price: next.price,
          status: "active",
          source: "manual",
          manualOverride: true,
        },
      });
    } catch { /* SW may be asleep */ }
  }, []);

  /** Canonical way for any child view to change the chart identity. */
  const handleContextChange = useCallback((next: TradingViewContext) => {
    setContext(next);
    setEnriched(null);
    notifyManualContext(next);
  }, [notifyManualContext]);

  const handleSelectSymbol = useCallback((s: string) => {
    const symbol = s.trim().toUpperCase();
    if (!symbol) return;
    const tf = context?.timeframe ?? "H1";
    const resolution = resolveMarketSymbol(symbol);
    const resolved = "symbol" in resolution ? resolution : null;
    const manual: TradingViewContext = {
      symbol,
      exchange: context?.exchange ?? null,
      timeframe: tf,
      price: null,
      isTradingView: false,
      rawSymbol: symbol,
      ticker: symbol,
      market: resolved?.market ?? classifyMarket(symbol),
      rawTimeframe: context?.rawTimeframe ?? context?.timeframe ?? null,
      priceSource: "unavailable",
      priceDisplay: null,
      status: "active",
      source: "manual",
      manualOverride: true,
      marketSymbol: resolved?.symbol ?? symbol,
      marketSync: resolved ? "unknown" : "unsupported",
      unsupportedReason: resolved ? null : ("reason" in resolution ? resolution.reason : null),
      timestamp: Date.now(),
      indicators: [],
      drawings: [],
      visibleRange: context?.visibleRange ?? { from: null, to: null, fromLabel: null, toLabel: null, bars: null, source: "unavailable" },
      symbolSources: ["manual"],
      timeframeSource: "manual",
    };
    handleContextChange(manual);
  }, [context, handleContextChange]);

  const symbolForAction = activeSymbol;

  const handleStrategyLab = useCallback(async () => {
    if (!symbolForAction) return;
    await openStrategyLab(symbolForAction, activeTimeframe || "H1", { exchange: effectiveContext?.exchange || null, price: activePrice });
  }, [symbolForAction, activeTimeframe, effectiveContext, activePrice]);

  const handleBacktest = useCallback(async () => {
    if (!symbolForAction) return;
    await runBacktestFromExtension(symbolForAction, activeTimeframe || "H1");
  }, [symbolForAction, activeTimeframe]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <p className="text-xs text-[#8888aa]">Loading AlgoVault...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView onAuth={handleAuth} />;
  }

  const renderView = () => {
    const sym = activeSymbol;
    const ctx = effectiveContext;
    switch (view) {
      case "analysis":
        return <AnalysisView symbol={sym} context={ctx} onBack={() => setView("main")} />;
      case "ai-copilot":
        return <AICopilotView symbol={sym} context={ctx} onBack={() => setView("main")} onContextChange={handleContextChange} />;
      case "risk":
        return <RiskView symbol={sym} context={ctx} onBack={() => setView("main")} />;
      case "signal":
        return <SignalView symbol={sym} context={ctx} onBack={() => setView("main")} />;
      case "execute":
        return <ExecuteView symbol={sym} context={ctx} onBack={() => setView("main")} />;
      case "quick-order":
        return <QuickOrderView symbol={sym} context={ctx} onBack={() => setView("main")} />;
      case "signals-list":
        return <SignalsListView onBack={() => setView("main")} />;
      case "settings":
        return <SettingsView onBack={() => setView("main")} onLogout={handleLogout} />;
      case "diagnostics":
        return <SettingsView onBack={() => setView("main")} onLogout={handleLogout} />;
      default:
        return (
          <MainView
            symbol={sym}
            context={ctx}
            marketContext={enriched?.market ?? null}
            isHealthy={isHealthy}
            gatewayConnected={gatewayConnected}
            onNavigate={setView}
            onSelectSymbol={handleSelectSymbol}
            onStrategyLab={handleStrategyLab}
            onBacktest={handleBacktest}
          />
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f] text-[#f0f0f5]">
      <Header
        isHealthy={isHealthy}
        gatewayConnected={gatewayConnected}
        userEmail={user ? (user.email as string || null) : null}
        onBack={view !== "main" ? () => setView("main") : undefined}
      />
      {offlineNotice && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
          <p className="text-[10px] text-amber-400">AlgoVault server is unreachable (offline mode). Some features may not work.</p>
        </div>
      )}
      <div className="animate-fade-in flex-1 min-h-0 overflow-y-auto">{renderView()}</div>
    </div>
  );
}
