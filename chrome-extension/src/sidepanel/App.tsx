/**
 * AlgoVault side panel — the AI Chart Copilot & Pro Intelligence surface.
 *
 * Lives next to TradingView in Chrome's side panel and follows the active
 * chart identity live: every chart switch re-targets the copilot, research,
 * alerts, setup radar, MTF matrix, and AI code generators.
 *
 * Tabs:
 *   Copilot    — chat with per-symbol memory, personas, model picker
 *   Radar      — Pro Setup Radar (Setup Memory live detection) [Pro]
 *   SmartAlerts— Pro Smart Alerts (deterministic signal engine) [Pro]
 *   MTF        — Multi-Timeframe Matrix [Pro]
 *   Indicators — AI Pine Script Indicator Generator [Pro]
 *   Strategies — AI Strategy Builder & Backtest Handoff [Pro]
 *   Research   — cached AI research notes
 *   Alerts     — standard price alerts
 *   Setup      — symbol/TF override, preferences
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Zap,
  RefreshCw,
  MessageSquareText,
  FlaskConical,
  Bell,
  SlidersHorizontal,
  Radar,
  ShieldAlert,
  Layers,
  Code,
  Cpu,
  Sparkles,
  ClipboardList,
  SearchX,
  History,
  HeartPulse,
  ScanEye,
  Command,
} from "lucide-react";
import { checkHealth, getGatewayStatus } from "@/api/algovault";
import { getAlgoVaultUrl } from "@/config/environment";
import { getAuthToken, getCachedContext, getUser } from "@/storage/storage";
import type { TradingViewContext } from "@/types";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import { useProAccess } from "@/services/pro-service";
import { ProGate } from "@/popup/components/ProGate";
import type { PreparedTradeDraft } from "@/types/execution";

import { CommandBar } from "./components/CommandBar";
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

type TabId =
  | "copilot"
  | "execution"
  | "radar"
  | "smartAlerts"
  | "mtf"
  | "indicators"
  | "strategies"
  | "checklist"
  | "missing"
  | "replay"
  | "health"
  | "marketRadar"
  | "research"
  | "alerts"
  | "setup";

interface TabConfig {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  isPro?: boolean;
}

const TABS: TabConfig[] = [
  { id: "copilot", label: "Copilot", icon: <MessageSquareText size={14} /> },
  { id: "execution", label: "Trade", icon: <Zap size={14} />, isPro: true },
  { id: "radar", label: "Radar", icon: <Radar size={14} />, isPro: true },
  { id: "smartAlerts", label: "Alerts+", icon: <ShieldAlert size={14} />, isPro: true },
  { id: "mtf", label: "MTF", icon: <Layers size={14} />, isPro: true },
  { id: "checklist", label: "Check", icon: <ClipboardList size={14} />, isPro: true },
  { id: "missing", label: "Gaps", icon: <SearchX size={14} />, isPro: true },
  { id: "replay", label: "Replay", icon: <History size={14} />, isPro: true },
  { id: "health", label: "Health", icon: <HeartPulse size={14} />, isPro: true },
  { id: "marketRadar", label: "Scan", icon: <ScanEye size={14} />, isPro: true },
  { id: "indicators", label: "Pine", icon: <Code size={14} />, isPro: true },
  { id: "strategies", label: "Strategy", icon: <Cpu size={14} />, isPro: true },
  { id: "research", label: "Research", icon: <FlaskConical size={14} /> },
  { id: "alerts", label: "Alerts", icon: <Bell size={14} /> },
  { id: "setup", label: "Setup", icon: <SlidersHorizontal size={14} /> },
];

function statusColor(state: "ok" | "off"): string {
  return state === "ok" ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" : "bg-neutral-600";
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
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
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
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
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
  }, [activeSymbol, activeTimeframe]);  const handleAnalyzeSetup = useCallback((setup: import("@/types/pro").SetupRadarCard) => {
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
      <div className="flex h-full items-center justify-center bg-base">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SidePanelLogin onAuth={handleAuth} />;
  }

  return (
    <div className="flex h-full flex-col bg-base text-ink">
      {/* header */}
      <div className="flex items-center gap-1.5 border-b border-edge bg-card px-2.5 py-2">
        <img
          src={chrome.runtime.getURL("icons/icon32.png")}
          alt="AlgoVault"
          className="h-4 w-4 object-contain rounded-sm"
        />
        <span className="text-xs font-bold tracking-tight">AlgoVault</span>
        {isPro ? (
          <span className="bg-brand-500/20 text-brand-400 border border-brand-500/40 rounded px-1.5 py-0.5 text-[9px] font-extrabold flex items-center gap-0.5">
            <Sparkles size={9} /> PRO
          </span>
        ) : (
          <span className="bg-raised text-ink-mute border border-edge rounded px-1 py-0.5 text-[9px] font-medium">
            FREE
          </span>
        )}

        <span className="ml-0.5 truncate rounded bg-raised px-1.5 py-0.5 font-mono text-[9px] text-ink-mute max-w-[90px]">
          {activeSymbol ? `${activeSymbol} · ${activeTimeframe}` : "no chart"}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${statusColor(
              isHealthy ? "ok" : "off"
            )}`}
            title="AlgoVault API"
          />
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${statusColor(
              gatewayConnected ? "ok" : "off"
            )}`}
            title="Gateway"
          />
          <button
            onClick={() => setCommandBarOpen(true)}
            className="flex items-center gap-1 rounded border border-edge bg-white/5 px-1.5 py-0.5 text-[9px] font-medium text-ink-mute hover:text-ink hover:border-brand-500/40 transition-colors"
            title="AI Command Bar (⌘K)"
          >
            <Command size={10} />
            <span className="font-mono text-[8px]">⌘K</span>
          </button>
          <button
            onClick={() => {
              refreshContext();
              setRefreshKey((k) => k + 1);
            }}
            className="rounded p-1 text-ink-mute hover:text-ink transition-colors"
            title="Refresh chart context"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => {
              setManualSymbol(activeSymbol ?? "");
              setManualTimeframe(activeTimeframe);
              setShowOverride(true);
            }}
            className="rounded p-1 text-ink-mute hover:text-ink transition-colors"
            title="Override symbol / timeframe"
          >
            <SlidersHorizontal size={12} />
          </button>
        </div>
      </div>

      {/* manual override bar */}
      {showOverride && (
        <div className="flex items-center gap-2 border-b border-edge bg-raised px-3 py-2 animate-fade-in">
          <input
            autoFocus
            value={manualSymbol}
            onChange={(e) => setManualSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyManual()}
            placeholder="Symbol (XAUUSD)"
            className="w-28 rounded border border-edge bg-base px-2 py-1 font-mono text-[11px] text-ink outline-none"
          />
          <input
            value={manualTimeframe}
            onChange={(e) => setManualTimeframe(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyManual()}
            placeholder="TF"
            className="w-12 rounded border border-edge bg-base px-2 py-1 font-mono text-[11px] text-ink outline-none"
          />
          <button
            onClick={applyManual}
            className="rounded bg-brand-500/20 px-2 py-1 text-[10px] font-semibold text-brand-400"
          >
            Apply
          </button>
          <button
            onClick={() => setShowOverride(false)}
            className="rounded px-2 py-1 text-[10px] text-ink-mute"
          >
            Cancel
          </button>
        </div>
      )}

      {/* body */}
      <div className="min-h-0 flex-1 overflow-hidden" key={refreshKey}>
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
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Zap size={28} className="text-brand-500" />
            <p className="text-xs font-medium text-ink">No chart detected</p>
            <p className="max-w-[240px] text-[10px] leading-relaxed text-ink-mute">
              Open a chart on TradingView and the copilot will follow it automatically — or set a
              symbol manually with the sliders icon above.
            </p>
          </div>
        )}
      </div>

      {/* tab bar */}
      <nav className="flex border-t border-edge bg-card overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 min-w-[44px] flex-col items-center justify-center py-1.5 px-0.5 transition-colors relative ${
                isActive ? "text-brand-500 font-semibold" : "text-ink-faint hover:text-ink-mute"
              }`}
            >
              {t.icon}
              <span className="text-[8.5px] tracking-tighter truncate max-w-full">{t.label}</span>
              {t.isPro && !isPro && (
                <span className="absolute top-1 right-1 w-1 h-1 rounded-full bg-brand-500" title="Pro Feature" />
              )}
            </button>
          );
        })}
      </nav>

      {/* AI Command Bar (⌘K) */}
      <CommandBar
        isOpen={commandBarOpen}
        onClose={() => setCommandBarOpen(false)}
        symbol={activeSymbol || ""}
        timeframe={activeTimeframe}
        onExecute={handleCommandExecute}
      />
    </div>
  );
}

/* ── login ──────────────────────────────────────────────────────────── */

function SidePanelLogin({ onAuth }: { onAuth: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      const { signInWithEmail } = await import("@/auth/auth");
      const result = await signInWithEmail(email, password);
      if (result.success) onAuth();
      else setError(result.error || "Login failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 bg-base">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15">
        <Zap size={18} className="text-brand-500" />
      </div>
      <p className="text-sm font-semibold text-ink">Sign in to AlgoVault Pro</p>
      <p className="text-center text-[10px] text-ink-mute">
        The extension uses your AlgoVault Pro account for AI access and intelligence services.
      </p>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        type="email"
        className="w-full max-w-[260px] rounded-lg border border-edge bg-raised px-3 py-2 text-xs text-ink outline-none focus:border-brand-500"
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Password"
        type="password"
        className="w-full max-w-[260px] rounded-lg border border-edge bg-raised px-3 py-2 text-xs text-ink outline-none focus:border-brand-500"
      />
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
      <button
        onClick={submit}
        disabled={loading || !email || !password}
        className="w-full max-w-[260px] rounded-lg bg-brand-500 py-2 text-xs font-semibold text-white transition-opacity hover:bg-brand-400 disabled:opacity-40"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <a
        href={`${getAlgoVaultUrlSafe()}/login`}
        target="_blank"
        rel="noreferrer"
        className="text-[10px] text-brand-400 hover:text-brand-300"
      >
        Open AlgoVault web login ↗
      </a>
    </div>
  );
}

function getAlgoVaultUrlSafe(): string {
  try {
    return (
      (typeof import.meta !== "undefined" &&
        (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ALGOVAULT_URL) ||
      "https://algovault.dev"
    );
  } catch {
    return "https://algovault.dev";
  }
}
