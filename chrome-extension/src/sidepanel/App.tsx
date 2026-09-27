/**
 * AlgoVault side panel — the AI Chart Copilot surface.
 *
 * Lives next to TradingView in Chrome's side panel and follows the active
 * chart identity live: every chart switch re-targets the copilot, research
 * and alerts. Tabs:
 *
 *   Copilot  — chat with per-symbol memory, personas, model picker
 *   Research — cached AI research notes (quick snapshot / deep dive)
 *   Alerts   — create & manage price alerts
 *   Setup    — symbol/TF override, preferences
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Zap, RefreshCw, MessageSquareText, FlaskConical, Bell, SlidersHorizontal } from "lucide-react";
import { checkHealth, getGatewayStatus } from "@/api/algovault";
import { getAuthToken, getCachedContext, getUser } from "@/storage/storage";
import type { TradingViewContext } from "@/types";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import { CopilotView } from "./views/CopilotView";
import { ResearchView } from "./views/ResearchView";
import { AlertsView } from "./views/AlertsView";
import { SetupView } from "./views/SetupView";

type TabId = "copilot" | "research" | "alerts" | "setup";

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "copilot", label: "Copilot", icon: <MessageSquareText size={15} /> },
  { id: "research", label: "Research", icon: <FlaskConical size={15} /> },
  { id: "alerts", label: "Alerts", icon: <Bell size={15} /> },
  { id: "setup", label: "Setup", icon: <SlidersHorizontal size={15} /> },
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
          } catch { setGatewayConnected(false); }
          try { setUser(await getUser()); } catch { setUser(null); }
        }
        const cached = await getCachedContext();
        if (cached.context?.symbol) setContext(cached.context);
        refreshContext();
      } catch { /* ignore */ } finally {
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

  const handleAuth = useCallback(() => { setIsAuthenticated(true); refreshContext(); }, [refreshContext]);

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

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
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
      <div className="flex items-center gap-2 border-b border-edge bg-card px-3 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/15">
          <Zap size={13} className="text-brand-500" />
        </div>
        <span className="text-sm font-semibold tracking-tight">AlgoVault Copilot</span>
        <span className="ml-1 rounded bg-raised px-1.5 py-0.5 font-mono text-[9px] text-ink-mute">
          {activeSymbol ? `${activeSymbol} · ${activeTimeframe}` : "no chart"}
        </span>
        {user?.email ? (
          <span className="max-w-[60px] truncate text-[9px] text-ink-faint" title={String(user.email)}>
            {String(user.email).split("@")[0]}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusColor(isHealthy ? "ok" : "off")}`} title="AlgoVault API" />
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusColor(gatewayConnected ? "ok" : "off")}`} title="Gateway" />
          <button
            onClick={() => { refreshContext(); setRefreshKey((k) => k + 1); }}
            className="rounded p-1 text-ink-mute hover:text-ink"
            title="Refresh chart context"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => { setManualSymbol(activeSymbol ?? ""); setManualTimeframe(activeTimeframe); setShowOverride(true); }}
            className="rounded p-1 text-ink-mute hover:text-ink"
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
          <button onClick={applyManual} className="rounded bg-brand-500/20 px-2 py-1 text-[10px] font-semibold text-brand-400">Apply</button>
          <button onClick={() => setShowOverride(false)} className="rounded px-2 py-1 text-[10px] text-ink-mute">Cancel</button>
        </div>
      )}

      {/* body */}
      <div className="min-h-0 flex-1 overflow-hidden" key={refreshKey}>
        {activeSymbol ? (
          <>
            {tab === "copilot" && (
              <CopilotView
                symbol={activeSymbol}
                timeframe={activeTimeframe}
                enriched={enriched}
                structuredContextKey={`${activeSymbol}|${activeTimeframe}|${refreshKey}`}
              />
            )}
            {tab === "research" && (
              <ResearchView
                symbol={activeSymbol}
                timeframe={activeTimeframe}
                structuredContextKey={`${activeSymbol}|${activeTimeframe}|${refreshKey}`}
              />
            )}
            {tab === "alerts" && (
              <AlertsView symbol={activeSymbol} timeframe={activeTimeframe} />
            )}
            {tab === "setup" && <SetupView />}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Zap size={28} className="text-brand-500" />
            <p className="text-xs font-medium text-ink">No chart detected</p>
            <p className="max-w-[240px] text-[10px] leading-relaxed text-ink-mute">
              Open a chart on TradingView and the copilot will follow it automatically — or set a symbol manually with the sliders icon above.
            </p>
          </div>
        )}
      </div>

      {/* tab bar */}
      <nav className="flex border-t border-edge bg-card">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors ${tab === t.id ? "text-brand-500" : "text-ink-faint hover:text-ink-mute"}`}
          >
            {t.icon}
            <span className="text-[9px] font-medium">{t.label}</span>
          </button>
        ))}
      </nav>
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
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15">
        <Zap size={18} className="text-brand-500" />
      </div>
      <p className="text-sm font-semibold">Sign in to AlgoVault</p>
      <p className="text-center text-[10px] text-ink-mute">
        The copilot uses your AlgoVault account for AI access and alerts.
      </p>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        type="email"
        className="w-full max-w-[260px] rounded-lg border border-edge bg-raised px-3 py-2 text-xs text-ink outline-none"
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Password"
        type="password"
        className="w-full max-w-[260px] rounded-lg border border-edge bg-raised px-3 py-2 text-xs text-ink outline-none"
      />
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
      <button
        onClick={submit}
        disabled={loading || !email || !password}
        className="w-full max-w-[260px] rounded-lg bg-brand-500 py-2 text-xs font-semibold text-white transition-opacity hover:bg-brand-400 disabled:opacity-40"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <a href={`${getAlgoVaultUrlSafe()}/login`} target="_blank" rel="noreferrer" className="text-[10px] text-brand-400 hover:text-brand-300">
        Open AlgoVault web login ↗
      </a>
    </div>
  );
}

function getAlgoVaultUrlSafe(): string {
  try {
    // Lazy import-free access mirrors config/environment's default.
    return typeof import.meta !== "undefined" && (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ALGOVAULT_URL || "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
}
