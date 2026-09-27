import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Brain, Shield, Target, Play, Layers, ClipboardList, Pencil, AlertCircle, Bot,
  Sparkles, ChevronRight,
} from "lucide-react";
import { getAlgoVaultUrl } from "@/config/environment";
import { openSidePanelFromExtensionPage, primeSidePanelWindowId } from "@/utils/side-panel";
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

const TIMEFRAMES = ["M5", "M15", "H1", "H4", "D1"];

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

  const tickColor = tick > 0 ? "text-emerald-400" : tick < 0 ? "text-rose-400" : "text-ink";

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
   * Open the AI Copilot side panel. chrome.sidePanel.open() must run inside a
   * LIVE user gesture — calling it inside a windows.getCurrent callback loses
   * the gesture and Chrome rejects it. openSidePanelFromExtensionPage() calls
   * it synchronously (with a SW fallback), so this handler stays gesture-safe.
   */
  const openCopilotSidePanel = () => {
    openSidePanelFromExtensionPage();
  };

  const actions: Array<{ id: string; label: string; icon: React.ReactNode; run: () => void; accent?: boolean }> = [
    { id: "copilot", label: "Copilot", icon: <Bot size={15} />, run: openCopilotSidePanel },
    { id: "strategy", label: "Strategy Lab", icon: <Layers size={15} />, run: onStrategyLab },
    { id: "backtest", label: "Backtest", icon: <ClipboardList size={15} />, run: onBacktest },
    { id: "optimize", label: "Optimize", icon: <Brain size={15} />, run: () => openWithSymbol("/strategy-lab") },
    { id: "risk", label: "Risk", icon: <Shield size={15} />, run: () => onNavigate("risk") },
    { id: "signal", label: "Signal", icon: <Target size={15} />, run: () => onNavigate("signal") },
    { id: "execute", label: "Trade", icon: <Play size={15} />, run: () => onNavigate("execute"), accent: true },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* ── symbol / price strip ─────────────────────────────────── */}
      <div className="border-b border-edge px-3 py-2.5">
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
              className="w-32 rounded border border-brand-500/40 bg-raised px-2 py-0.5 font-mono text-sm text-ink outline-none"
            />
          ) : (
            <button
              onClick={() => { setInputValue(symbol || ""); setEditing(true); }}
              className="flex items-center gap-1 rounded px-1 py-0.5 font-mono text-sm font-semibold text-ink transition-colors hover:text-brand-400"
              title="Change symbol"
            >
              {symbol || "No symbol"}
              <Pencil size={10} className="text-ink-faint" />
            </button>
          )}

          {/* timeframe switcher */}
          <div className="ml-auto flex items-center gap-0.5 rounded-md border border-edge bg-raised p-0.5">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => onSelectTimeframe(t)}
                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${
                  t === tf ? "bg-brand-500 text-white" : "text-ink-mute hover:text-ink"
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
                <span className="text-[9px] font-semibold text-emerald-400">LIVE</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 pb-0.5 text-ink-faint">
                <AlertCircle size={10} />
                <span className="text-[9px]">syncing…</span>
              </span>
            )}
          </div>
          {closes.length > 5 && <Sparkline data={closes} width={84} height={24} />}
        </div>
      </div>

      {/* ── verdict card ─────────────────────────────────────────── */}
      {ready && mc ? (
        <div className="border-b border-edge px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DirIcon d={asDirection(mc.trend.direction)} size={14} />
              <span className={`text-xs font-bold uppercase tracking-wide ${asDirection(mc.trend.direction) === "bullish" ? "text-emerald-400" : asDirection(mc.trend.direction) === "bearish" ? "text-rose-400" : "text-neutral-400"}`}>
                {mc.trend.direction}
              </span>
              <Badge className={mc.score.bias === "bullish" ? "bg-emerald-500/15 text-emerald-400" : mc.score.bias === "bearish" ? "bg-rose-500/15 text-rose-400" : "bg-white/5 text-neutral-400"}>
                {mc.marketRegime.regime.replace(/_/g, " ")}
              </Badge>
            </div>
            <span className="font-mono text-[10px] text-ink-mute">
              score <span className={mc.score.bias === "bullish" ? "text-emerald-400" : mc.score.bias === "bearish" ? "text-rose-400" : "text-neutral-400"}>{mc.score.total}</span>/100
            </span>
          </div>

          {setup && (
            <div className="mt-2 rounded-lg border border-edge bg-card p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-ink-mute uppercase tracking-wider">Setup</span>
                <span className={`text-[11px] font-bold ${setup.direction === "long" ? "text-emerald-400" : setup.direction === "short" ? "text-rose-400" : "text-neutral-400"}`}>
                  {setup.label} · {setup.confidence}
                </span>
              </div>
              <div className="mt-1.5">
                <ConfidenceMeter score={setup.score} direction={asDirection(setup.direction)} />
              </div>
              {setup.reasons.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {setup.reasons.slice(0, 3).map((r, i) => (
                    <li key={i} className="flex items-start gap-1 text-[9px] leading-snug text-ink-mute">
                      <span className="mt-[3px] h-0.5 w-0.5 shrink-0 rounded-full bg-brand-500" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mc.mtfAlignment.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="text-[9px] font-medium uppercase tracking-wider text-ink-faint">MTF</span>
              {mc.mtfAlignment.map((m, i) => (
                <Badge
                  key={i}
                  className={m.bias === "bullish" ? "bg-emerald-500/10 text-emerald-400" : m.bias === "bearish" ? "bg-rose-500/10 text-rose-400" : "bg-white/5 text-neutral-500"}
                >
                  {m.timeframe} {m.bias === "bullish" ? "▲" : m.bias === "bearish" ? "▼" : "•"}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="border-b border-edge px-3 py-3 text-center">
          <p className="text-[10px] text-ink-faint">
            {symbol ? "Waiting for market data…" : "Set a symbol or open a TradingView chart"}
          </p>
        </div>
      )}

      {/* ── action grid ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* free daily AI signals entry point */}
        <button
          onClick={() => onNavigate("ai-signals")}
          className="group mb-3 flex w-full items-center gap-2.5 rounded-lg border border-brand-500/30 bg-gradient-to-r from-brand-500/15 to-transparent px-3 py-2.5 text-left transition-all hover:border-brand-500/50 hover:from-brand-500/25"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/20 text-brand-400 transition-colors group-hover:bg-brand-500/30">
            <Sparkles size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold text-ink">AI Daily Signals</span>
            <span className="block text-[9px] leading-snug text-ink-mute">
              3 free signals per day — pick 3 symbols, get entry, SL &amp; 3 targets
            </span>
          </span>
          <ChevronRight size={14} className="shrink-0 text-brand-400" />
        </button>

        <div className="grid grid-cols-3 gap-2">
          {actions.map((a) => (
            <button
              key={a.id}
              onClick={a.run}
              className={`group flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-all active:scale-[0.97] ${
                a.accent
                  ? "border-brand-500/30 bg-brand-500/10 hover:bg-brand-500/20"
                  : "border-edge bg-card hover:border-brand-500/25 hover:bg-raised"
              }`}
            >
              <span className={a.accent ? "text-brand-400" : "text-ink-mute group-hover:text-brand-400 transition-colors"}>
                {a.icon}
              </span>
              <span className={`text-[10px] font-medium ${a.accent ? "text-brand-100" : "text-ink-mute group-hover:text-ink"} transition-colors`}>
                {a.label}
              </span>
            </button>
          ))}
        </div>

        {enriched?.priceValidation.state === "mismatched" && (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-[9px] leading-snug text-amber-400">
              Chart price deviates {Math.abs(enriched.priceValidation.deviationPct ?? 0).toFixed(2)}% from market data — verify the symbol.
            </p>
          </div>
        )}

        {!gatewayConnected && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-edge bg-card px-2.5 py-2">
            <span className="text-[10px] text-ink-mute">Trading gateway offline — analysis still works</span>
            <button
              onClick={() => window.open(`${getAlgoVaultUrl()}/trading`, "_blank")}
              className="text-[10px] font-medium text-brand-400 hover:text-brand-300"
            >
              Connect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
