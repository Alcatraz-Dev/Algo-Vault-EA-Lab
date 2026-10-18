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
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* ── health rating config ─────────────────────────────────────────────── */

const RATING_CFG: Record<HealthRating, { icon: React.ReactNode; color: string; label: string }> = {
  GOOD: { icon: <CheckCircle2 size={11} />, color: "text-positive", label: "Good" },
  ALIGNED: { icon: <CheckCircle2 size={11} />, color: "text-positive", label: "Aligned" },
  ELEVATED: { icon: <AlertTriangle size={11} />, color: "text-warning", label: "Elevated" },
  MIXED: { icon: <AlertTriangle size={11} />, color: "text-warning", label: "Mixed" },
  EXTREME: { icon: <XCircle size={11} />, color: "text-negative", label: "Extreme" },
  CONFLICT: { icon: <XCircle size={11} />, color: "text-negative", label: "Conflict" },
  POOR: { icon: <XCircle size={11} />, color: "text-negative", label: "Poor" },
  INSUFFICIENT_DATA: { icon: <HelpCircle size={11} />, color: "text-muted-foreground", label: "No Data" },
};

function RatingBadge({ rating }: { rating: HealthRating }) {
  const cfg = RATING_CFG[rating] ?? RATING_CFG.INSUFFICIENT_DATA;
  return (
    <span className={`flex items-center gap-1 text-[10px] font-bold ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function ConditionBar({ matched, total }: { matched: number; total: number }) {
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
  const color =
    pct >= 80 ? "bg-positive" : pct >= 60 ? "bg-warning" : "bg-negative";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-16 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-numeric text-[10px] text-muted-foreground">
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
      ? "border-positive/30 bg-positive/5"
      : card.marketCompatibility === "ELEVATED" || card.marketCompatibility === "MIXED"
      ? "border-warning/30 bg-warning/5"
      : card.marketCompatibility === "EXTREME" || card.marketCompatibility === "CONFLICT" || card.marketCompatibility === "POOR"
      ? "border-negative/30 bg-negative/5"
      : "border-border bg-secondary";

  return (
    <div className={`rounded-xl border ${overallColor} overflow-hidden`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground leading-tight truncate">
            {card.strategyName}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{card.regime}</p>
        </div>
        <RatingBadge rating={card.marketCompatibility} />
        <span className="text-muted-foreground shrink-0">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2.5 space-y-2.5">
          {/* metrics grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground">Conditions Met</p>
              <ConditionBar matched={card.conditionsMatched} total={card.conditionsTotal} />
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground">HTF Alignment</p>
              <RatingBadge rating={card.htfAlignment} />
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground">Volatility</p>
              <RatingBadge rating={card.volatilityState} />
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground">Data</p>
              <span className={`text-[10px] font-semibold ${
                card.dataSufficiency === "HIGH"
                  ? "text-positive"
                  : card.dataSufficiency === "MODERATE"
                  ? "text-warning"
                  : "text-negative"
              }`}>
                {card.dataSufficiency}
              </span>
            </div>
          </div>

          {/* notes */}
          {card.notes.length > 0 && (
            <div className="space-y-0.5 pt-0.5">
              <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Notes</p>
              {card.notes.map((n, i) => (
                <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">· {n}</p>
              ))}
            </div>
          )}

          {/* historical research indicator */}
          {card.historicalResearchAvailable && (
            <p className="text-[10px] text-muted-foreground">
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
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <HeartPulse size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Strategy Health</span>
        {data && (
          <span className="ml-auto font-numeric text-[10px] text-muted-foreground">
            {goodCount} / {data.strategies.length} compatible
          </span>
        )}
        <button
          onClick={load}
          disabled={loading || !symbol}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 ml-1"
          title="Check strategy health"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* idle */}
        {!data && !loading && !error && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <HeartPulse size={24} className="text-muted-foreground" />
            <p className="text-[11px] font-medium text-foreground">Strategy Health Monitor</p>
            <p className="max-w-[220px] text-[10px] text-muted-foreground leading-relaxed">
              Shows which of your saved strategies are compatible with current {symbol || "chart"}
              market conditions — no fabricated win rates.
            </p>
            <Button
              variant="brand"
              size="sm"
              onClick={load}
              disabled={!symbol}
              className="text-[11px]"
            >
              Check Health
            </Button>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="flex flex-col items-center gap-2 py-8">
            <RefreshCw size={18} className="animate-spin text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground">Evaluating strategy conditions…</p>
          </div>
        )}

        {/* error */}
        {error && !loading && (
          <Alert variant="destructive">
            <AlertTriangle size={12} />
            <AlertDescription className="text-[11px]">
              {error}
              <button
                onClick={load}
                className="mt-1.5 block text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry →
              </button>
            </AlertDescription>
          </Alert>
        )}

        {/* no strategies */}
        {data && data.strategies.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <HeartPulse size={20} className="text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground">
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
          <p className="text-center text-[10px] text-muted-foreground pt-1">
            Checked {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "—"}
          </p>
        )}
      </div>
    </div>
  );
}
