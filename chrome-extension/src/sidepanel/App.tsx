/**
 * AlgoVault side panel — the AI Chart Copilot & Pro Intelligence surface.
 *
 * Lives next to TradingView in Chrome's side panel and follows the active
 * chart identity live: every chart switch re-targets the copilot, research,
 * alerts, setup radar, MTF matrix, and AI code generators.
 *
 * Information architecture: a grouped left icon rail (Work → Intelligence →
 * Build → Trade → System) rather than the popup's bottom tab bar, because the
 * side panel is tall and narrow — vertical groups stay scannable at 15
 * destinations, while a bottom strip would clip labels at this width.
 *
 *   Copilot     — chat with per-symbol memory, personas, model picker
 *   Radar       — Pro Setup Radar (Setup Memory live detection) [Pro]
 *   SmartAlerts — Pro Smart Alerts (deterministic signal engine) [Pro]
 *   MTF         — Multi-Timeframe Matrix [Pro]
 *   Indicators  — AI Pine Script Indicator Generator [Pro]
 *   Strategies  — AI Strategy Builder & Backtest Handoff [Pro]
 *   Research    — cached AI research notes
 *   Alerts      — standard price alerts
 *   Setup       — symbol/TF override, preferences
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Command,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import { checkHealth, getGatewayStatus } from "@/api/algovault";
import { getAlgoVaultUrl, PRODUCTION_ALGOVAULT_URL } from "@/config/environment";
import { getAuthToken, getCachedContext, getUser } from "@/storage/storage";
import { canAttemptSignIn, PRIVACY_POLICY_PATH } from "@/auth/consent";
import { signInWithEmail } from "@/auth/auth";
import { DataConsentNotice } from "@/components/DataConsentNotice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TradingViewContext } from "@/types";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import { useProAccess } from "@/services/pro-service";
import { ProGate } from "@/popup/components/ProGate";
import type { PreparedTradeDraft } from "@/types/execution";

import { CommandBar } from "./components/CommandBar";
import { NavRail, type NavTabId } from "./components/NavRail";
import { CopilotView } from "./views/CopilotView";
import { ResearchView } from "./views/ResearchView";
import { AlertsView } from "./views/AlertsView";
import { SetupView } from "./views/SetupView";
import { ProSetupRadarView } from "./views/ProSetupRadarView";
import { ProSmartAlertsView } from "./views/ProSmartAlertsView";
import { ProMTFView } from "./views/ProMTFView";
import { ProIndicatorGeneratorView } from "./views/ProIndicatorGeneratorView";
import { ProStrategyGeneratorView } from "./views/ProStrategyGeneratorView";
import { ProPreTradeChecklistView } from "./views/ProPreTradeChecklistView";
import { ProWhatAmIMissingView } from "./views/ProWhatAmIMissingView";
import { ProSetupReplayView } from "./views/ProSetupReplayView";
import { ProStrategyHealthView } from "./views/ProStrategyHealthView";
import { ProMarketRadarView } from "./views/ProMarketRadarView";
import { ProExecutionBridgeView } from "./views/ProExecutionBridgeView";

type TabId = NavTabId;

function StatusPill({ ok, label, title }: { ok: boolean; label: string; title: string }) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-positive" : "bg-muted-foreground/40")}
      />
      {label}
    </span>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isHealthy, setIsHealthy] = useState(false);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [context, setContext] = useState<TradingViewContext | null>(null);
  const [enriched, setEnriched] = useState<EnrichedChartContext | null>(null);
  const [tab, setTab] = useState<TabId>("copilot");
  const [refreshKey, setRefreshKey] = useState(0);
  const [showOverride, setShowOverride] = useState(false);
  const [manualSymbol, setManualSymbol] = useState("");
  const [manualTimeframe, setManualTimeframe] = useState("");
  const [analysisPrompt, setAnalysisPrompt] = useState<string | null>(null);
  const [preparedDraft, setPreparedDraft] = useState<PreparedTradeDraft | null>(null);
  const [executionFocus, setExecutionFocus] = useState<
    "ticket" | "positions" | "pending" | "history"
  >("ticket");

  const { isPro, access: proAccess, flags } = useProAccess();

  const effectiveContext = useMemo<TradingViewContext | null>(() => {
    if (enriched?.chart && (enriched.chart.symbol || enriched.chart.marketSymbol)) {
      return enriched.chart as TradingViewContext;
    }
    return context;
  }, [enriched, context]);

  const activeSymbol = effectiveContext?.symbol ?? null;
  const activeTimeframe = effectiveContext?.timeframe || "H1";

  const refreshContext = useCallback(() => {
    chrome.runtime.sendMessage({ type: "GET_AI_READY_CONTEXT" }, (resp) => {
      if (resp?.enriched) setEnriched(resp.enriched as EnrichedChartContext);
      if (resp?.chart) setContext(resp.chart as TradingViewContext);
    });
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const token = await getAuthToken();
        setIsAuthenticated(!!token);
        setIsHealthy(await checkHealth());
        if (token) {
          try {
            const gw = await getGatewayStatus();
            setGatewayConnected(gw.connected);
          } catch {
            setGatewayConnected(false);
          }
          try {
            setUser(await getUser());
          } catch {
            setUser(null);
          }
        }
        const cached = await getCachedContext();
        if (cached.context?.symbol) setContext(cached.context);
        refreshContext();
      } catch {
        /* ignore */
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [refreshContext]);

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

  const handleAuth = useCallback(() => {
    setIsAuthenticated(true);
    refreshContext();
  }, [refreshContext]);

  const applyManual = () => {
    const sym = manualSymbol.trim().toUpperCase();
    if (!sym) return;
    const next: TradingViewContext = {
      ...(context ?? ({} as TradingViewContext)),
      symbol: sym,
      exchange: null,
      timeframe: manualTimeframe.trim().toUpperCase() || "H1",
      price: null,
      isTradingView: false,
      rawSymbol: sym,
      ticker: sym,
      marketSymbol: sym,
      status: "active",
      source: "manual",
      manualOverride: true,
      timestamp: Date.now(),
    };
    chrome.runtime.sendMessage({ type: "SET_CHART_CONTEXT", payload: next });
    setContext(next);
    setEnriched(null);
    setShowOverride(false);
    setRefreshKey((k) => k + 1);
  };

  const [commandBarOpen, setCommandBarOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandBarOpen((v) => !v);
        return;
      }
      // Bare-key shortcuts, only when the user isn't typing into a field.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        setTab("copilot");
        setAnalysisPrompt(`Give me the full analysis of ${activeSymbol} (${activeTimeframe}) right now.`);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setTab("radar");
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setTab("replay");
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setTab("strategies");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSymbol, activeTimeframe]);

  const handleCommandExecute = useCallback((id: import("@/types/pro").CommandId) => {
    switch (id) {
      case "analyze_chart":
        setTab("copilot");
        setAnalysisPrompt(`Give me the full reading of ${activeSymbol} (${activeTimeframe}) right now.`);
        break;
      case "what_am_i_missing":
        setTab("missing");
        break;
      case "run_checklist":
        setTab("checklist");
        break;
      case "show_similar_setups":
        setTab("replay");
        break;
      case "show_strategy_health":
        setTab("health");
        break;
      case "show_market_radar":
        setTab("marketRadar");
        break;
      case "show_mtf":
        setTab("mtf");
        break;
      case "show_smart_alerts":
        setTab("smartAlerts");
        break;
      case "create_indicator":
        setTab("indicators");
        break;
      case "create_strategy":
        setTab("strategies");
        break;
      case "research_setup":
        window.open(`${getAlgoVaultUrl()}/strategy-research?symbol=${encodeURIComponent(activeSymbol || "")}`, "_blank");
        break;
      case "backtest_setup":
        window.open(`${getAlgoVaultUrl()}/backtests?symbol=${encodeURIComponent(activeSymbol || "")}`, "_blank");
        break;
      case "open_algovault":
        window.open(`${getAlgoVaultUrl()}/account/pro-trading-extension`, "_blank");
        break;
      case "open_research":
        window.open(`${getAlgoVaultUrl()}/strategy-research`, "_blank");
        break;
      case "show_open_positions":
        setExecutionFocus("positions");
        setTab("execution");
        break;
      case "prepare_modification":
      case "prepare_close":
        setExecutionFocus("positions");
        setTab("execution");
        break;
      case "explain_position":
        setAnalysisPrompt(
          `Explain my open ${activeSymbol} position: entry logic, current market context, what would invalidate it and what the strategy conditions say now.`
        );
        setTab("copilot");
        break;
      case "show_market_context":
        setAnalysisPrompt(
          `Show the current market context for ${activeSymbol} (${activeTimeframe}): structure, liquidity, FVG, momentum, HTF alignment and volatility.`
        );
        setTab("copilot");
        break;
      default:
        setTab("copilot");
        break;
    }
  }, [activeSymbol, activeTimeframe]);

  const handleAnalyzeSetup = useCallback((setup: import("@/types/pro").SetupRadarCard) => {
    const setupPrompt = `Analyze this Setup Radar card for ${setup.symbol} (${setup.timeframe}): setup type "${setup.setupType}", direction ${setup.direction}, status ${setup.status}. Supporting evidence: ${setup.supportingEvidence.join(";")}. Risk context: ${setup.riskContext || "none"}. Provide trade execution steps.`;
    setAnalysisPrompt(setupPrompt);
    setTab("copilot");
  }, []);

  /** AI Setup → trade preparation (§5): pre-fills the ticket, never executes. */
  const handlePrepareTrade = useCallback((setup: import("@/types/pro").SetupRadarCard) => {
    const side: "BUY" | "SELL" = setup.direction === "SHORT" ? "SELL" : "BUY";
    setPreparedDraft({
      source: "setup_radar",
      symbol: setup.symbol,
      side,
      orderType: setup.entryZone ? "LIMIT" : "MARKET",
      quantity: null,
      price: setup.entryZone ? setup.entryZone.from : null,
      stopLoss: setup.invalidation ?? null,
      takeProfit: setup.targets && setup.targets.length > 0 ? setup.targets[0] : null,
      timeframe: setup.timeframe,
      strategyId: setup.strategyId ?? null,
      strategyName: setup.strategyName ?? null,
      setupId: setup.id,
      analysisId: setup.memoryId ?? null,
      riskContext: setup.riskContext ?? null,
      preparedAt: Date.now(),
    });
    setExecutionFocus("ticket");
    setTab("execution");
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">Connecting to AlgoVault…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <TooltipProvider delayDuration={300}>
        <SidePanelLogin onAuth={handleAuth} />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* Header — identity, live chart target, connection health, actions */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/60">
            <img
              src={chrome.runtime.getURL("icons/icon32.png")}
              alt="AlgoVault"
              className="h-4 w-4 rounded-sm object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </span>

          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-tight">AlgoVault</span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wide",
                isPro
                  ? "border-brand/40 bg-brand/10 text-brand-foreground"
                  : "border-border bg-secondary/60 text-muted-foreground"
              )}
            >
              {isPro && <Sparkles className="h-2.5 w-2.5" />}
              {isPro ? "PRO" : "FREE"}
            </span>
            <span
              className="inline-flex min-w-0 items-center rounded-full border border-border bg-secondary/40 px-1.5 py-0.5 font-numeric text-[10px] text-muted-foreground"
              title="Live chart context"
            >
              <span className="truncate">
                {activeSymbol ? `${activeSymbol} · ${activeTimeframe}` : "no chart"}
              </span>
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <span className="flex items-center gap-1">
              <StatusPill ok={isHealthy} label="API" title="AlgoVault API health" />
              <StatusPill ok={gatewayConnected} label="GW" title="MT5 gateway connection" />
            </span>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setCommandBarOpen(true)}
                  aria-label="Open command bar"
                >
                  <Command className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Command bar · ⌘K</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Refresh chart context"
                  onClick={() => {
                    refreshContext();
                    setRefreshKey((k) => k + 1);
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh chart context</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Override symbol and timeframe"
                  onClick={() => {
                    setManualSymbol(activeSymbol ?? "");
                    setManualTimeframe(activeTimeframe);
                    setShowOverride(true);
                  }}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Override symbol / timeframe</TooltipContent>
            </Tooltip>
          </div>
        </header>

          {/* Manual override — chart identity override for off-TradingView use */}
          {showOverride && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary/40 px-2.5 py-2">
              <Input
                autoFocus
                value={manualSymbol}
                onChange={(e) => setManualSymbol(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyManual()}
                placeholder="Symbol (XAUUSD)"
                className="h-8 w-28 font-numeric text-[11px]"
                aria-label="Symbol"
              />
              <Input
                value={manualTimeframe}
                onChange={(e) => setManualTimeframe(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyManual()}
                placeholder="TF"
                className="h-8 w-14 font-numeric text-[11px]"
                aria-label="Timeframe"
              />
              <Button size="sm" variant="brand" onClick={applyManual}>
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowOverride(false)}>
                Cancel
              </Button>
            </div>
          )}

          {/* Body — rail navigation + active destination */}
          <div className="flex min-h-0 flex-1">
            <NavRail active={tab} onSelect={setTab} isPro={isPro} />
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto" key={refreshKey}>
              {activeSymbol || tab === "setup" ? (
                <>
                  {tab === "copilot" && (
                    <CopilotView
                      symbol={activeSymbol || "BTCUSD"}
                      timeframe={activeTimeframe}
                      enriched={enriched}
                      structuredContextKey={`${activeSymbol}|${activeTimeframe}|${refreshKey}`}
                      initialPrompt={analysisPrompt}
                      onPromptConsumed={() => setAnalysisPrompt(null)}
                    />
                  )}

                  {tab === "radar" && (
                    <ProGate featureName="Setup Radar" flagEnabled={flags.setupRadar}>
                      <ProSetupRadarView
                        symbol={activeSymbol || ""}
                        timeframe={activeTimeframe}
                        onAnalyzeSetup={handleAnalyzeSetup}
                        onPrepareTrade={handlePrepareTrade}
                      />
                    </ProGate>
                  )}

                  {tab === "smartAlerts" && (
                    <ProGate featureName="Smart Alerts" flagEnabled={flags.smartAlerts}>
                      <ProSmartAlertsView
                        symbol={activeSymbol || ""}
                        timeframe={activeTimeframe}
                      />
                    </ProGate>
                  )}

                  {tab === "mtf" && (
                    <ProGate featureName="MTF Intelligence" flagEnabled={flags.mtfIntelligence}>
                      <ProMTFView symbol={activeSymbol || ""} timeframe={activeTimeframe} />
                    </ProGate>
                  )}

                  {tab === "checklist" && (
                    <ProGate featureName="Pre-Trade Checklist" flagEnabled={flags.preTradeChecklist}>
                      <ProPreTradeChecklistView
                        symbol={activeSymbol || ""}
                        timeframe={activeTimeframe}
                      />
                    </ProGate>
                  )}

                  {tab === "missing" && (
                    <ProGate featureName="What Am I Missing" flagEnabled={flags.preTradeChecklist}>
                      <ProWhatAmIMissingView
                        symbol={activeSymbol || ""}
                        timeframe={activeTimeframe}
                      />
                    </ProGate>
                  )}

                  {tab === "replay" && (
                    <ProGate featureName="Historical Replay" flagEnabled={flags.historicalReplay}>
                      <ProSetupReplayView
                        symbol={activeSymbol || ""}
                        timeframe={activeTimeframe}
                      />
                    </ProGate>
                  )}

                  {tab === "health" && (
                    <ProGate featureName="Strategy Health" flagEnabled={flags.strategyHealth}>
                      <ProStrategyHealthView
                        symbol={activeSymbol || ""}
                        timeframe={activeTimeframe}
                      />
                    </ProGate>
                  )}

                  {tab === "marketRadar" && (
                    <ProGate featureName="Market Radar" flagEnabled={flags.marketRadar}>
                      <ProMarketRadarView
                        symbol={activeSymbol || ""}
                        timeframe={activeTimeframe}
                        onSelectSymbol={(sym) => {
                          const next: import("@/types").TradingViewContext = {
                            ...(context ?? ({} as import("@/types").TradingViewContext)),
                            symbol: sym,
                            exchange: null,
                            timeframe: activeTimeframe,
                            price: null,
                            isTradingView: false,
                            rawSymbol: sym,
                            ticker: sym,
                            marketSymbol: sym,
                            status: "active",
                            source: "manual",
                            manualOverride: true,
                            timestamp: Date.now(),
                          };
                          setContext(next);
                          setRefreshKey((k) => k + 1);
                          setTab("copilot");
                        }}
                      />
                    </ProGate>
                  )}

                  {tab === "indicators" && (
                    <ProGate
                      featureName="AI Indicator Generator"
                      flagEnabled={flags.aiIndicatorGenerator}
                    >
                      <ProIndicatorGeneratorView
                        symbol={activeSymbol || ""}
                        timeframe={activeTimeframe}
                      />
                    </ProGate>
                  )}

                  {tab === "strategies" && (
                    <ProGate
                      featureName="AI Strategy Studio"
                      flagEnabled={flags.aiStrategyGenerator}
                    >
                      <ProStrategyGeneratorView
                        symbol={activeSymbol || ""}
                        timeframe={activeTimeframe}
                      />
                    </ProGate>
                  )}

                  {tab === "execution" && (
                    <ProExecutionBridgeView
                      key={executionFocus}
                      initialSubTab={executionFocus}
                      activeSymbol={activeSymbol || "EURUSD"}
                      activePrice={context?.price ?? undefined}
                      contextTimestamp={context?.timestamp ?? null}
                      timeframe={activeTimeframe}
                      preparedDraft={preparedDraft}
                      onDraftConsumed={() => setPreparedDraft(null)}
                    />
                  )}

                  {tab === "research" && (
                    <ResearchView
                      symbol={activeSymbol || "BTCUSD"}
                      timeframe={activeTimeframe}
                      structuredContextKey={`${activeSymbol}|${activeTimeframe}|${refreshKey}`}
                    />
                  )}

                  {tab === "alerts" && (
                    <AlertsView symbol={activeSymbol || "BTCUSD"} timeframe={activeTimeframe} />
                  )}

                  {tab === "setup" && <SetupView />}
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <div className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-secondary/50">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs font-medium text-foreground">No chart detected</p>
                  <p className="max-w-[240px] text-[11px] leading-relaxed text-muted-foreground">
                    Open a chart on TradingView and the copilot will follow it automatically — or set
                    a symbol manually with the sliders button above.
                  </p>
                </div>
              )}
            </main>
          </div>

          {/* AI Command Bar (⌘K) */}
          <CommandBar
            isOpen={commandBarOpen}
            onClose={() => setCommandBarOpen(false)}
            symbol={activeSymbol || ""}
            timeframe={activeTimeframe}
            onExecute={handleCommandExecute}
          />
      </div>
    </TooltipProvider>
  );
}

/* ── login ──────────────────────────────────────────────────────────── */

function SidePanelLogin({ onAuth }: { onAuth: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = canAttemptSignIn({ email, password, consentGiven: consent, loading });

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // Same consent gate as the popup login: no sign-in attempt (including
    // a submit event) can bypass the explicit data-handling consent.
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const result = await signInWithEmail(email, password);
    if (result.success) {
      onAuth();
    } else {
      setError(result.error || "Authentication failed");
    }
    setLoading(false);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background px-6 py-8">
      <div className="mx-auto flex w-full max-w-[300px] flex-1 flex-col justify-center">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/60">
            <img
              src={chrome.runtime.getURL("logos/logo.png")}
              alt="AlgoVault logo"
              className="h-5 w-5 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </span>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">AlgoVault</h1>
            <p className="text-[11px] text-muted-foreground">Trading Intelligence</p>
          </div>
        </div>

        <h2 className="mt-6 text-base font-semibold tracking-tight">Sign in</h2>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Use your AlgoVault account for AI access and intelligence services.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="av-sidepanel-email" className="text-xs">
              Email
            </Label>
            <Input
              id="av-sidepanel-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="av-sidepanel-password" className="text-xs">
              Password
            </Label>
            <div className="relative">
              <Input
                id="av-sidepanel-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          <DataConsentNotice
            checked={consent}
            onChange={setConsent}
            privacyUrl={`${getAlgoVaultUrlSafe()}${PRIVACY_POLICY_PATH}`}
            id="av-data-consent-sidepanel"
          />

          <Button type="submit" size="lg" variant="brand" disabled={!canSubmit} className="w-full gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <a
          href={`${getAlgoVaultUrlSafe()}/login`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign in on the AlgoVault website
          <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

function getAlgoVaultUrlSafe(): string {
  try {
    // Single source of truth lives in @/config/environment (production
    // default + VITE override). This wrapper only guards non-module
    // contexts where import.meta may be unavailable.
    return getAlgoVaultUrl();
  } catch {
    return PRODUCTION_ALGOVAULT_URL;
  }
}
