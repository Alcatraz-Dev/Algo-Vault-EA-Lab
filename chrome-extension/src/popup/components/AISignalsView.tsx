/**
 * AI Signals — free daily AI trade ideas for the popup.
 *
 * The user pins up to 3 symbols, hits "Generate", and gets at most one AI
 * signal per symbol with entry, stop loss and three take-profit targets.
 * Free quota: 3 signals per calendar day.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, Sparkles, Radar, X, TrendingUp, TrendingDown,
  AlertCircle, Lock, Target,
} from "lucide-react";
import type { TradingViewContext } from "@/types";
import type { DailySignal } from "@/types";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import {
  MAX_SIGNAL_SYMBOLS,
  FREE_DAILY_SIGNAL_LIMIT,
  loadSelectedSymbols,
  storeSelectedSymbols,
  getQuota,
  generateDailySignals,
  type DailyQuota,
} from "@/services/daily-signals-service";
import { BackButton } from "./ui";

function fmt(v: number): string {
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  if (v >= 100) return v.toFixed(2);
  if (v >= 10) return v.toFixed(3);
  return v.toFixed(4);
}

interface AISignalsViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  enriched: EnrichedChartContext | null;
  onBack: () => void;
}

const SUGGESTED_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "NAS100", "US30", "AUDUSD"];

export function AISignalsView({ symbol, enriched, onBack }: AISignalsViewProps) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [quota, setQuota] = useState<DailyQuota>({ used: 0, limit: FREE_DAILY_SIGNAL_LIMIT, remaining: FREE_DAILY_SIGNAL_LIMIT, day: "", source: "server" });
  const [signals, setSignals] = useState<DailySignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      const [stored, q] = await Promise.all([loadSelectedSymbols(), getQuota()]);
      setSymbols(stored);
      setQuota(q);
      // Server-restored signals (survive reinstall) show up until the user
      // generates a fresh batch this session.
      try {
        const { getExtensionDailySignalsState } = await import("@/api/algovault");
        const serverState = await getExtensionDailySignalsState();
        if (serverState?.signals?.length) {
          setSignals((prev) => {
            if (prev.length > 0) return prev;
            return serverState.signals
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((s) => ({
                id: `ds_${String(s.symbol).toLowerCase()}_${s.createdAt}`,
                symbol: String(s.symbol).toUpperCase(),
                direction: String(s.direction).toUpperCase() === "SELL" ? "SELL" : "BUY",
                timeframe: String(s.timeframe || "M15"),
                entry: Number(s.entry),
                stopLoss: Number(s.stopLoss),
                takeProfit1: Number(s.takeProfit1),
                takeProfit2: Number(s.takeProfit2),
                takeProfit3: Number(s.takeProfit3),
                confidence: Number(s.confidence) || 0,
                setup: String(s.setup ?? ""),
                reasoning: String(s.reasoning ?? ""),
                createdAt: Number(s.createdAt) || Date.now(),
                riskReward: Number.isFinite(Number(s.riskReward)) ? Number(s.riskReward) : undefined,
                chartEvidence: Array.isArray(s.chartEvidence) ? s.chartEvidence.slice(0, 6) : undefined,
                chartLevels: Array.isArray(s.chartLevels) ? s.chartLevels.slice(0, 12) : undefined,
              } as DailySignal));
          });
        }
        if (serverState?.symbols?.length) {
          setSymbols((prev) => (prev.length > 0 ? prev : serverState.symbols.slice(0, MAX_SIGNAL_SYMBOLS)));
        }
      } catch { /* offline — local state is enough */ }
      setHydrated(true);
    })();
  }, []);

  const addSymbol = useCallback(async (raw: string) => {
    const s = raw.trim().toUpperCase();
    if (!s || symbols.includes(s) || symbols.length >= MAX_SIGNAL_SYMBOLS) return;
    const next = [...symbols, s];
    setSymbols(next);
    await storeSelectedSymbols(next);
    setInput("");
  }, [symbols]);

  const removeSymbol = useCallback(async (s: string) => {
    const next = symbols.filter((x) => x !== s);
    setSymbols(next);
    await storeSelectedSymbols(next);
  }, [symbols]);

  const generate = useCallback(async () => {
    if (loading || quota.remaining === 0 || symbols.length === 0) return;
    setLoading(true);
    setNote(null);
    try {
      const contexts = new Map<string, EnrichedChartContext | null>();
      if (symbol) contexts.set(symbol.toUpperCase(), enriched);
      const result = await generateDailySignals({ symbols, contexts });
      if (result.signals.length > 0) setSignals((prev) => [...result.signals, ...prev].slice(0, 9));
      setQuota(result.quota);
      setNote(result.note);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Failed to generate signals — is the AlgoVault server reachable?");
    } finally {
      setLoading(false);
    }
  }, [loading, quota.remaining, symbols, symbol, enriched]);

  const canGenerate = hydrated && symbols.length > 0 && quota.remaining > 0 && !loading;

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
          <Sparkles size={13} className="text-brand-400" /> AI Signals
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${quota.remaining > 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
          {quota.remaining}/{quota.limit} free today
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {/* symbol picker */}
        <section>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
            Your symbols ({symbols.length}/{MAX_SIGNAL_SYMBOLS})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {symbols.map((s) => (
              <span key={s} className="flex items-center gap-1 rounded-md border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] text-brand-300">
                {s}
                <button onClick={() => removeSymbol(s)} className="text-brand-400/70 hover:text-rose-400" title={`Remove ${s}`}>
                  <X size={9} />
                </button>
              </span>
            ))}
            {symbols.length === 0 && <span className="text-[10px] text-ink-faint">Add up to 3 symbols…</span>}
          </div>
          {symbols.length < MAX_SIGNAL_SYMBOLS && (
            <>
              <div className="mt-2 flex gap-1.5">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) addSymbol(input); }}
                  placeholder="Add symbol (XAUUSD)"
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[11px] uppercase text-ink outline-none placeholder:text-ink-faint focus:border-brand-500/60"
                />
                <button
                  onClick={() => addSymbol(input)}
                  disabled={!input.trim()}
                  className="rounded-lg bg-brand-500/20 px-3 text-[11px] font-semibold text-brand-400 hover:bg-brand-500/30 disabled:opacity-30"
                >
                  Add
                </button>
              </div>
              {symbols.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {SUGGESTED_SYMBOLS.filter((s) => !symbols.includes(s)).slice(0, 5).map((s) => (
                    <button
                      key={s}
                      onClick={() => addSymbol(s)}
                      className="rounded border border-edge px-1.5 py-0.5 font-mono text-[9px] text-ink-faint hover:border-brand-500/40 hover:text-brand-400"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* generate */}
        <button
          onClick={generate}
          disabled={!canGenerate}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 py-2.5 text-xs font-semibold text-white transition-opacity hover:bg-brand-400 disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : quota.remaining === 0 ? <Lock size={14} /> : <Radar size={14} />}
          {loading ? "Analyzing your symbols…" : quota.remaining === 0 ? "Daily limit reached" : `Generate ${Math.min(symbols.length, quota.remaining) || ""} daily signal${(Math.min(symbols.length, quota.remaining) || 0) === 1 ? "" : "s"}`}
        </button>

        {note && (
          <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-[10px] leading-snug text-amber-400">{note}</p>
          </div>
        )}

        {/* signal cards */}
        {signals.length > 0 && (
          <section className="space-y-2">
            {signals.map((sig) => (
              <SignalCard key={sig.id} signal={sig} />
            ))}
          </section>
        )}

        {signals.length === 0 && !loading && hydrated && (
          <p className="pt-2 text-center text-[10px] leading-relaxed text-ink-faint">
            Pick up to 3 symbols and generate your free daily AI signals — each with entry, stop loss and 3 take-profit targets.
          </p>
        )}
      </div>

      <div className="flex items-center border-t border-edge bg-card/60 px-3 py-2">
        <BackButton onClick={onBack} />
      </div>
    </div>
  );
}

function SignalCard({ signal: s }: { signal: DailySignal }) {
  const buy = s.direction === "BUY";
  return (
    <div className="space-y-2 rounded-lg border border-edge bg-white/[0.02] p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-ink">{s.symbol}</span>
          <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${buy ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
            {buy ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {s.direction}
          </span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-ink-mute">{s.timeframe}</span>
        </div>
        <span className={`font-mono text-[10px] font-semibold ${s.confidence >= 75 ? "text-emerald-400" : s.confidence >= 60 ? "text-amber-400" : "text-ink-mute"}`}>
          {s.confidence}%
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1 text-center">
        <PriceCell label="Entry" value={fmt(s.entry)} cls="text-ink" />
        <PriceCell label="SL" value={fmt(s.stopLoss)} cls="text-rose-400" />
        <PriceCell label="TP1" value={fmt(s.takeProfit1)} cls="text-emerald-400" />
        <PriceCell label="TP2" value={fmt(s.takeProfit2)} cls="text-emerald-400" />
        <PriceCell label="TP3" value={fmt(s.takeProfit3)} cls="text-emerald-400" />
      </div>

      {(s.setup || s.reasoning) && (
        <div className="border-t border-white/5 pt-1.5">
          {s.setup && (
            <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-ink-mute">
              <Target size={9} className="text-brand-400" /> {s.setup}
            </p>
          )}
          {s.reasoning && <p className="mt-0.5 text-[9px] leading-snug text-ink-faint">{s.reasoning}</p>}
        </div>
      )}

      {/* Chart confluence — the drawn levels that backed the engine's call,
          mirroring the web signal detail's transparency. */}
      {(typeof s.riskReward === "number" && s.riskReward > 0) || (s.chartEvidence?.length ?? 0) > 0 ? (
        <div className="border-t border-white/5 pt-1.5">
          {typeof s.riskReward === "number" && s.riskReward > 0 && (
            <p className="font-mono text-[9px] text-ink-faint">
              R:R <span className="text-ink-mute">{s.riskReward.toFixed(1)}</span>
            </p>
          )}
          {s.chartEvidence && s.chartEvidence.length > 0 && (
            <ul className="mt-0.5 space-y-0.5">
              {s.chartEvidence.slice(0, 3).map((e, i) => (
                <li key={i} className="truncate text-[9px] leading-snug text-ink-faint" title={e}>
                  · {e}
                </li>
              ))}
            </ul>
          )}
          {s.chartLevels && s.chartLevels.length > 0 && (
            <p className="mt-0.5 truncate text-[8px] uppercase tracking-wider text-ink-faint/70" title={s.chartLevels.map((l) => `${l.label} ${l.price}`).join(" · ")}>
              {s.chartLevels.slice(0, 4).map((l) => l.label).join(" · ")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PriceCell({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div>
      <span className="block text-[8px] uppercase tracking-wider text-ink-faint">{label}</span>
      <span className={`block font-mono text-[10px] font-semibold ${cls}`}>{value}</span>
    </div>
  );
}
