import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Brain, Shield, Target, Play, Layers, ClipboardList, Pencil, AlertCircle, Bot,
  Sparkles, ChevronRight, PanelRight, FlaskConical,
} from "lucide-react";
import { getAlgoVaultUrl } from "@/config/environment";
import { openCopilotFloatingPanel, primeSidePanelWindowId } from "@/utils/side-panel";
import type { TradingViewContext, ViewMode } from "@/types";
import type { MarketContext } from "@/types/market-context";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import { getOHLCData } from "@/api/algovault";
import {
  asDirection, Badge, ConfidenceMeter, DirIcon, Sparkline, StatusDot,
} from "./ui";

interface MainViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  isHealthy: boolean;
  gatewayConnected: boolean;
  marketContext: MarketContext | null;
  enriched: EnrichedChartContext | null;
  onNavigate: (view: ViewMode) => void;
  onSelectSymbol: (s: string) => void;
  onSelectTimeframe: (tf: string) => void;
  onStrategyLab: () => void;
  onBacktest: () => void;
}

// Standard timeframes shown in the switcher. We always append the actively
// detected timeframe (from TradingView) so e.g. "M3" stays highlighted even
// if the user's chart is on an unusual resolution.
const BASE_TIMEFRAMES = ["M1", "M5", "M15", "H1", "H4", "D1"];

function buildTimeframes(active: string | null | undefined): string[] {
  if (!active || BASE_TIMEFRAMES.includes(active)) return BASE_TIMEFRAMES;
  // Insert the active TF in the correct position (shortest first).
  const order = ["M1", "M2", "M3", "M4", "M5", "M10", "M15", "M30", "H1", "H2", "H4", "H8", "H12", "D1", "W1"];
  const idx = order.indexOf(active);
  const merged = [...BASE_TIMEFRAMES];
  if (idx !== -1) {
    const insertAt = merged.findIndex((t) => order.indexOf(t) > idx);
    merged.splice(insertAt === -1 ? merged.length : insertAt, 0, active);
  } else {
    merged.unshift(active);
  }
  return merged;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (v >= 100) return v.toFixed(2);
  return v.toFixed(4);
}

export function MainView({
  symbol, context, gatewayConnected, marketContext, enriched,
  onNavigate, onSelectSymbol, onSelectTimeframe, onStrategyLab, onBacktest,
}: MainViewProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(symbol || "");
  const [closes, setCloses] = useState<number[]>([]);
  const [tick, setTick] = useState(0);
  const prevRef = useRef<number | null>(null);

  /* Cache the window id so the Copilot button can open the side panel
     synchronously (user-gesture requirement). */
  useEffect(() => {
    primeSidePanelWindowId();
  }, []);

  const mc = marketContext;
  const setup = enriched?.setup ?? null;
  const price = mc?.currentPrice ?? context?.price ?? null;
  const ready = mc?.status === "ready";
  const tf = context?.timeframe || "H1";

  /* track tick direction for the price flash */
  useEffect(() => {
    if (price == null) return;
    const prev = prevRef.current;
    if (prev != null && price !== prev) setTick(price > prev ? 1 : -1);
    prevRef.current = price;
  }, [price]);

  /* recent closes for the sparkline (best effort — silent when offline) */
  useEffect(() => {
    let alive = true;
    const marketSymbol = context?.marketSymbol || symbol;
    if (!marketSymbol || !ready) { setCloses([]); return; }
    getOHLCData(marketSymbol, tf, 60)
      .then((d) => { if (alive) setCloses(d.candles.slice(-60).map((c) => c.close)); })
      .catch(() => { /* sparkline is optional */ });
    return () => { alive = false; };
  }, [context?.marketSymbol, symbol, tf, ready]);

  const tickColor = tick > 0 ? "text-positive" : tick < 0 ? "text-negative" : "text-foreground";

  const handleSymbolSubmit = () => {
    const val = inputValue.trim().toUpperCase();
    if (val) onSelectSymbol(val);
    setEditing(false);
  };

  const openWithSymbol = (path: string) => {
    const base = context?.symbol || symbol || "";
    window.open(`${getAlgoVaultUrl()}${path}?symbol=${encodeURIComponent(base)}&timeframe=${tf}`, "_blank");
  };

  /**
   * Open the AI Copilot panel: a draggable floating popup on the TradingView
   * tab when one is open, falling back to Chrome's docked side panel
   * otherwise (see openCopilotFloatingPanel). Gesture-safe: the SW relay runs
   * synchronously inside the message hop from this click.
   */
  const openCopilotSidePanel = () => {
    openCopilotFloatingPanel();
  };

  const actions: Array<{ id: string; label: string; icon: React.ReactNode; run: () => void; accent?: boolean }> = [
    // In-popup Copilot tab — instant, no side-panel gesture constraints.
    { id: "copilot", label: "Copilot", icon: <Bot size={15} />, run: () => onNavigate("ai-copilot") },
    { id: "sidepanel", label: "Side Panel", icon: <PanelRight size={15} />, run: openCopilotSidePanel },
    { id: "strategy", label: "Strategy Lab", icon: <Layers size={15} />, run: onStrategyLab },
    { id: "backtest", label: "Backtest", icon: <ClipboardList size={15} />, run: onBacktest },
    { id: "optimize", label: "Optimize", icon: <Brain size={15} />, run: () => openWithSymbol("/strategy-lab") },
    { id: "risk", label: "Risk", icon: <Shield size={15} />, run: () => onNavigate("risk") },
    { id: "signal", label: "Signal", icon: <Target size={15} />, run: () => onNavigate("signal") },
    { id: "demo", label: "Demo", icon: <FlaskConical size={15} />, run: () => onNavigate("demo-trades") },
    { id: "execute", label: "Trade", icon: <Play size={15} />, run: () => onNavigate("execute"), accent: true },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* ── symbol / price strip ─────────────────────────────────── */}
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          {editing ? (
            <input
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={handleSymbolSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSymbolSubmit();
                if (e.key === "Escape") { setInputValue(symbol || ""); setEditing(false); }
              }}
              placeholder="XAUUSD"
              className="w-32 rounded-lg border border-input bg-transparent px-2 py-0.5 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            />
          ) : (
            <button
              onClick={() => { setInputValue(symbol || ""); setEditing(true); }}
              className="flex items-center gap-1 rounded px-1 py-0.5 font-mono text-sm font-semibold text-foreground transition-colors hover:text-foreground"
              title="Change symbol"
            >
              {symbol || "No symbol"}
              <Pencil size={10} className="text-muted-foreground/70" />
            </button>
          )}

          {/* timeframe switcher */}
          <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
            {buildTimeframes(tf).map((t) => (
              <button
                key={t}
                onClick={() => onSelectTimeframe(t)}
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  t === tf ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-1.5 flex items-end justify-between">
          <div className="flex items-baseline gap-2">
            <span
              className={`font-mono text-xl font-bold transition-colors duration-300 ${tickColor}`}
            >
              {fmtPrice(price)}
            </span>
            {ready ? (
              <span className="flex items-center gap-1 pb-0.5">
                <StatusDot state="ok" />
                <span className="text-[10px] font-semibold text-positive">LIVE</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 pb-0.5 text-muted-foreground/70">
                <AlertCircle size={10} />
                <span className="text-[10px]">syncing…</span>
              </span>
            )}
          </div>
          {closes.length > 5 && <Sparkline data={closes} width={84} height={24} />}
        </div>
      </div>

      {/* ── verdict card ─────────────────────────────────────────── */}
      {ready && mc ? (
        <div className="border-b border-border px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DirIcon d={asDirection(mc.trend.direction)} size={14} />
              <span className={`text-xs font-bold uppercase tracking-wide ${asDirection(mc.trend.direction) === "bullish" ? "text-positive" : asDirection(mc.trend.direction) === "bearish" ? "text-negative" : "text-muted-foreground"}`}>
                {mc.trend.direction}
              </span>
              <Badge className={mc.score.bias === "bullish" ? "bg-positive/15 text-positive" : mc.score.bias === "bearish" ? "bg-negative/15 text-negative" : "bg-muted text-muted-foreground"}>
                {mc.marketRegime.regime.replace(/_/g, " ")}
              </Badge>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              score <span className={mc.score.bias === "bullish" ? "text-positive" : mc.score.bias === "bearish" ? "text-negative" : "text-muted-foreground"}>{mc.score.total}</span>/100
            </span>
          </div>

          {setup && (
            <div className="mt-2 rounded-xl border border-border bg-card p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Setup</span>
                <span className={`text-[11px] font-bold ${setup.direction === "long" ? "text-positive" : setup.direction === "short" ? "text-negative" : "text-muted-foreground"}`}>
                  {setup.label} · {setup.confidence}
                </span>
              </div>
              <div className="mt-1.5">
                <ConfidenceMeter score={setup.score} direction={asDirection(setup.direction)} />
              </div>
              {setup.reasons.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {setup.reasons.slice(0, 3).map((r, i) => (
                    <li key={i} className="flex items-start gap-1 text-[10px] leading-snug text-muted-foreground">
                      <span className="mt-[3px] h-0.5 w-0.5 shrink-0 rounded-full bg-muted-foreground/70" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mc.mtfAlignment.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">MTF</span>
              {mc.mtfAlignment.map((m, i) => (
                <Badge
                  key={i}
                  className={m.bias === "bullish" ? "bg-positive/10 text-positive" : m.bias === "bearish" ? "bg-negative/10 text-negative" : "bg-muted text-muted-foreground"}
                >
                  {m.timeframe} {m.bias === "bullish" ? "▲" : m.bias === "bearish" ? "▼" : "•"}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="border-b border-border px-3 py-3 text-center">
          <p className="text-[11px] text-muted-foreground">
            {symbol ? "Waiting for market data…" : "Set a symbol or open a TradingView chart"}
          </p>
        </div>
      )}

      {/* ── action grid ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* free daily AI signals entry point */}
        <button
          onClick={() => onNavigate("ai-signals")}
          className="group mb-3 flex w-full items-center gap-2.5 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2.5 text-left transition-colors hover:border-brand-500/50 hover:bg-brand-500/15"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/20 text-brand-foreground transition-colors group-hover:bg-brand-500/30">
            <Sparkles size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold text-foreground">AI Daily Signals</span>
            <span className="block text-[11px] leading-snug text-muted-foreground">
              3 free signals per day — pick 3 symbols, get entry, SL &amp; 3 targets
            </span>
          </span>
          <ChevronRight size={14} className="shrink-0 text-muted-foreground/70" />
        </button>

        <div className="grid grid-cols-3 gap-2">
          {actions.map((a) => (
            <button
              key={a.id}
              onClick={a.run}
              className={`group flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors ${
                a.accent
                  ? "border-brand-500/30 bg-brand-500/10 hover:bg-brand-500/20"
                  : "border-border bg-card hover:border-muted-foreground/40 hover:bg-muted"
              }`}
            >
              <span className={a.accent ? "text-brand-500" : "text-muted-foreground group-hover:text-foreground transition-colors"}>
                {a.icon}
              </span>
              <span className={`text-[10px] font-medium ${a.accent ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"} transition-colors`}>
                {a.label}
              </span>
            </button>
          ))}
        </div>

        {enriched?.priceValidation.state === "mismatched" && (
          <div className="mt-3 flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/10 px-2.5 py-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-[11px] leading-snug text-warning">
              Chart price deviates {Math.abs(enriched.priceValidation.deviationPct ?? 0).toFixed(2)}% from market data — verify the symbol.
            </p>
          </div>
        )}

        {!gatewayConnected && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-card px-2.5 py-2">
            <span className="text-[11px] text-muted-foreground">Trading gateway offline — analysis still works</span>
            <button
              onClick={() => window.open(`${getAlgoVaultUrl()}/trading`, "_blank")}
              className="text-[11px] font-medium text-brand-foreground underline-offset-2 hover:underline"
            >
              Connect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
