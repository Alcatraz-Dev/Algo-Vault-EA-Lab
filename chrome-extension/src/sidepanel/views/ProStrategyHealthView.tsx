/**
 * Pro Strategy Health View
 *
 * Shows how well each saved strategy aligns with current market conditions:
 *   - Market compatibility (volatility regime, structure type)
 *   - HTF alignment
 *   - Condition match rate
 *   - Data sufficiency rating
 *
 * Helps traders know which strategy is appropriate NOW without fabricating
 * win rates or outcome predictions.
 */
import React, { useState, useCallback } from "react";
import {
  HeartPulse,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { fetchStrategyHealth } from "@/api/pro";
import type { StrategyHealthCard, StrategyHealthResponse, HealthRating } from "@/types/pro";

/* ── health rating config ─────────────────────────────────────────────── */

const RATING_CFG: Record<HealthRating, { icon: React.ReactNode; color: string; label: string }> = {
  GOOD: { icon: <CheckCircle2 size={11} />, color: "text-emerald-400", label: "Good" },
  ALIGNED: { icon: <CheckCircle2 size={11} />, color: "text-emerald-400", label: "Aligned" },
  ELEVATED: { icon: <AlertTriangle size={11} />, color: "text-amber-400", label: "Elevated" },
  MIXED: { icon: <AlertTriangle size={11} />, color: "text-amber-400", label: "Mixed" },
  EXTREME: { icon: <XCircle size={11} />, color: "text-rose-400", label: "Extreme" },
  CONFLICT: { icon: <XCircle size={11} />, color: "text-rose-400", label: "Conflict" },
  POOR: { icon: <XCircle size={11} />, color: "text-rose-400", label: "Poor" },
  INSUFFICIENT_DATA: { icon: <HelpCircle size={11} />, color: "text-ink-faint", label: "No Data" },
};

function RatingBadge({ rating }: { rating: HealthRating }) {
  const cfg = RATING_CFG[rating] ?? RATING_CFG.INSUFFICIENT_DATA;
  return (
    <span className={`flex items-center gap-1 text-[9px] font-bold ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function ConditionBar({ matched, total }: { matched: number; total: number }) {
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
  const color =
    pct >= 80 ? "bg-emerald-400" : pct >= 60 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-16 rounded-full bg-raised overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] text-ink-mute tabular-nums">
        {matched}/{total}
      </span>
    </div>
  );
}

function StrategyCard({ card }: { card: StrategyHealthCard }) {
  const [expanded, setExpanded] = useState(false);
  const compatCfg = RATING_CFG[card.marketCompatibility] ?? RATING_CFG.INSUFFICIENT_DATA;

  const overallColor =
    card.marketCompatibility === "GOOD" || card.marketCompatibility === "ALIGNED"
      ? "border-emerald-500/25 bg-emerald-500/5"
      : card.marketCompatibility === "ELEVATED" || card.marketCompatibility === "MIXED"
      ? "border-amber-500/25 bg-amber-500/5"
      : card.marketCompatibility === "EXTREME" || card.marketCompatibility === "CONFLICT" || card.marketCompatibility === "POOR"
      ? "border-rose-500/25 bg-rose-500/5"
      : "border-edge bg-raised";

  return (
    <div className={`rounded-lg border ${overallColor} overflow-hidden`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-ink leading-tight truncate">
            {card.strategyName}
          </p>
          <p className="text-[9px] text-ink-faint mt-0.5">{card.regime}</p>
        </div>
        <RatingBadge rating={card.marketCompatibility} />
        <span className="text-ink-faint shrink-0">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-edge/40 px-3 py-2.5 space-y-2.5">
          {/* metrics grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <p className="text-[9px] text-ink-faint">Conditions Met</p>
              <ConditionBar matched={card.conditionsMatched} total={card.conditionsTotal} />
            </div>
            <div className="space-y-0.5">
              <p className="text-[9px] text-ink-faint">HTF Alignment</p>
              <RatingBadge rating={card.htfAlignment} />
            </div>
            <div className="space-y-0.5">
              <p className="text-[9px] text-ink-faint">Volatility</p>
              <RatingBadge rating={card.volatilityState} />
            </div>
            <div className="space-y-0.5">
              <p className="text-[9px] text-ink-faint">Data</p>
              <span className={`text-[9px] font-semibold ${
                card.dataSufficiency === "HIGH"
                  ? "text-emerald-400"
                  : card.dataSufficiency === "MODERATE"
                  ? "text-amber-400"
                  : "text-rose-400"
              }`}>
                {card.dataSufficiency}
              </span>
            </div>
          </div>

          {/* notes */}
          {card.notes.length > 0 && (
            <div className="space-y-0.5 pt-0.5">
              <p className="text-[9px] font-bold tracking-widest text-ink-faint uppercase">Notes</p>
              {card.notes.map((n, i) => (
                <p key={i} className="text-[10px] text-ink-mute leading-relaxed">· {n}</p>
              ))}
            </div>
          )}

          {/* historical research indicator */}
          {card.historicalResearchAvailable && (
            <p className="text-[9px] text-sky-400">
              ↗ Historical research available in Strategy Lab
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── main view ────────────────────────────────────────────────────────── */

interface Props {
  symbol: string;
  timeframe: string;
}

export function ProStrategyHealthView({ symbol, timeframe }: Props) {
  const [data, setData] = useState<StrategyHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStrategyHealth(symbol, timeframe);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health data");
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  const goodCount =
    data?.strategies.filter(
      (s) => s.marketCompatibility === "GOOD" || s.marketCompatibility === "ALIGNED"
    ).length ?? 0;

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-edge bg-card px-3 py-2">
        <HeartPulse size={13} className="text-brand-400" />
        <span className="text-[11px] font-semibold text-ink">Strategy Health</span>
        {data && (
          <span className="ml-auto text-[10px] text-ink-mute">
            {goodCount} / {data.strategies.length} compatible
          </span>
        )}
        <button
          onClick={load}
          disabled={loading || !symbol}
          className="rounded p-1 text-ink-mute hover:text-ink disabled:opacity-40 transition-colors ml-1"
          title="Check strategy health"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* idle */}
        {!data && !loading && !error && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <HeartPulse size={24} className="text-ink-faint" />
            <p className="text-[11px] font-medium text-ink">Strategy Health Monitor</p>
            <p className="max-w-[220px] text-[10px] text-ink-mute leading-relaxed">
              Shows which of your saved strategies are compatible with current {symbol || "chart"}
              market conditions — no fabricated win rates.
            </p>
            <button
              onClick={load}
              disabled={!symbol}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-[10px] font-semibold text-white hover:bg-brand-400 disabled:opacity-40 transition-colors"
            >
              Check Health
            </button>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="flex flex-col items-center gap-2 py-8">
            <RefreshCw size={18} className="animate-spin text-brand-400" />
            <p className="text-[10px] text-ink-mute">Evaluating strategy conditions…</p>
          </div>
        )}

        {/* error */}
        {error && !loading && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
            <p className="text-[10px] text-rose-400">{error}</p>
            <button onClick={load} className="mt-1.5 text-[10px] text-rose-300 hover:text-rose-200">
              Retry →
            </button>
          </div>
        )}

        {/* no strategies */}
        {data && data.strategies.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <HeartPulse size={20} className="text-ink-faint" />
            <p className="text-[10px] text-ink-mute">
              No saved strategies found. Create one in the Strategy tab.
            </p>
          </div>
        )}

        {/* strategy cards */}
        {data &&
          data.strategies.length > 0 &&
          !loading &&
          [...data.strategies]
            .sort((a, b) => {
              const order: Record<string, number> = {
                GOOD: 0,
                ALIGNED: 1,
                ELEVATED: 2,
                MIXED: 3,
                EXTREME: 4,
                CONFLICT: 5,
                POOR: 6,
                INSUFFICIENT_DATA: 7,
              };
              return (order[a.marketCompatibility] ?? 9) - (order[b.marketCompatibility] ?? 9);
            })
            .map((card) => <StrategyCard key={card.strategyId} card={card} />)}

        {data && (
          <p className="text-center text-[9px] text-ink-faint pt-1">
            Checked {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "—"}
          </p>
        )}
      </div>
    </div>
  );
}
