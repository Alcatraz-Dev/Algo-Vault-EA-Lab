/**
 * Pro Pre-Trade Checklist View
 *
 * Deterministic, evidence-grounded checklist before entering a trade.
 * Evaluates market structure, liquidity, momentum, volatility, HTF context,
 * and strategy condition alignment — strictly based on server analytics.
 *
 * Never fabricates data. Shows exact evidence source for every item.
 */
import React, { useState, useCallback } from "react";
import {
  ClipboardList,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Database,
  BarChart3,
  ShieldAlert,
} from "lucide-react";
import { fetchPreTradeChecklist, fetchEvidenceScore } from "@/api/pro";
import type { ChecklistItem, PreTradeChecklistResponse, EvidenceScoreBreakdown } from "@/types/pro";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";


/* ── helpers ──────────────────────────────────────────────────────────── */

const STATUS_CONFIG = {
  confirmed: {
    icon: <CheckCircle2 size={13} />,
    color: "text-positive",
    bg: "bg-positive/10 border-positive/30",
    label: "CONFIRMED",
  },
  warning: {
    icon: <AlertTriangle size={13} />,
    color: "text-warning",
    bg: "bg-warning/10 border-warning/30",
    label: "WARNING",
  },
  failed: {
    icon: <XCircle size={13} />,
    color: "text-negative",
    bg: "bg-negative/10 border-negative/30",
    label: "FAILED",
  },
  unresolved: {
    icon: <Clock size={13} />,
    color: "text-muted-foreground",
    bg: "bg-secondary border-border",
    label: "UNRESOLVED",
  },
};

const CATEGORY_ORDER = [
  "MARKET STRUCTURE",
  "LIQUIDITY",
  "HTF CONTEXT",
  "MOMENTUM",
  "VOLATILITY",
  "FVG",
  "STRATEGY CONDITIONS",
];

function ChecklistItemRow({ item }: { item: ChecklistItem }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[item.status];

  return (
    <div className={`rounded-xl border ${cfg.bg} overflow-hidden`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={cfg.color}>{cfg.icon}</span>
        <span className="flex-1 text-[11px] font-medium text-foreground leading-tight">{item.title}</span>
        <span className={`text-[10px] font-bold tracking-wider ${cfg.color}`}>{cfg.label}</span>
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          <p className="text-[10px] text-muted-foreground leading-relaxed">{item.explanation}</p>
          {item.unresolvedReason && (
            <p className="text-[10px] text-muted-foreground italic">{item.unresolvedReason}</p>
          )}
          {item.rawEvidence && item.rawEvidence.length > 0 && (
            <div className="space-y-0.5">
              {item.rawEvidence.map((e, i) => (
                <p key={i} className="font-numeric text-[10px] text-muted-foreground">
                  · {e}
                </p>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 pt-0.5">
            <Database size={10} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{item.evidenceSource}</span>
          </div>
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

export function ProPreTradeChecklistView({ symbol, timeframe }: Props) {
  const [data, setData] = useState<PreTradeChecklistResponse | null>(null);
  const [evidenceScore, setEvidenceScore] = useState<EvidenceScoreBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const [result, score] = await Promise.all([
        fetchPreTradeChecklist(symbol, timeframe),
        fetchEvidenceScore(symbol, timeframe).catch(() => null),
      ]);
      setData(result);
      if (score) setEvidenceScore(score);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load checklist");
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  // Group items by category in canonical order
  const grouped = data
    ? CATEGORY_ORDER.reduce<Record<string, ChecklistItem[]>>((acc, cat) => {
        const items = data.items.filter((i) => i.category === cat);
        if (items.length > 0) acc[cat] = items;
        return acc;
      }, {})
    : {};

  const passRate =
    data && data.totalCount > 0
      ? Math.round((data.passedCount / data.totalCount) * 100)
      : null;

  const passColor =
    passRate === null
      ? "text-muted-foreground"
      : passRate >= 80
      ? "text-positive"
      : passRate >= 60
      ? "text-warning"
      : "text-negative";

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <ClipboardList size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Pre-Trade Checklist</span>
        {data && (
          <span className={`ml-auto font-numeric text-[11px] font-bold ${passColor}`}>
            {data.passedCount}/{data.totalCount} passed
          </span>
        )}
        <button
          onClick={load}
          disabled={loading || !symbol}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
          title="Run checklist"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* progress bar */}
        {data && (
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  passRate! >= 80
                    ? "bg-positive"
                    : passRate! >= 60
                    ? "bg-warning"
                    : "bg-negative"
                }`}
                style={{ width: `${passRate}%` }}
              />
            </div>
            <p className={`text-right font-numeric text-[10px] font-semibold ${passColor}`}>
              {passRate}% conditions met
            </p>
          </div>
        )}

        {/* Evidence Score Visualization */}
        {evidenceScore && (
          <div className="rounded-xl border border-border bg-card p-2.5 space-y-2">
            <div className="flex items-center justify-between border-b border-border pb-1.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-foreground">
                <BarChart3 size={11} /> EVIDENCE SCORE
              </span>
              <span className="text-[10px] text-muted-foreground">Condition Alignment</span>
            </div>
            <div className="space-y-1.5">
              {evidenceScore.categories.map((c) => {
                const filled = c.score;
                const total = c.maxScore;
                const pct = Math.round((filled / total) * 100);
                const barColor =
                  filled >= 8 ? "bg-positive" : filled >= 6 ? "bg-warning" : "bg-negative";
                return (
                  <div key={c.name} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-numeric font-semibold text-muted-foreground">{c.name}</span>
                      <span className="font-numeric text-muted-foreground">{c.label} ({filled}/{total})</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] italic text-muted-foreground leading-tight">
              {evidenceScore.disclaimer}
            </p>
          </div>
        )}

        {/* idle state */}
        {!data && !loading && !error && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <ClipboardList size={24} className="text-muted-foreground" />
            <p className="text-[11px] font-medium text-foreground">Run Pre-Trade Checklist</p>
            <p className="max-w-[220px] text-[10px] text-muted-foreground leading-relaxed">
              Evaluates {symbol || "current symbol"} against deterministic market structure,
              liquidity, and strategy conditions.
            </p>
            <Button
              variant="brand"
              size="sm"
              onClick={load}
              disabled={!symbol}
              className="text-[11px]"
            >
              Run Checklist
            </Button>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="flex flex-col items-center gap-2 py-8">
            <RefreshCw size={18} className="animate-spin text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground">Evaluating conditions…</p>
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

        {/* grouped items */}
        {data && !loading && (
          <div className="space-y-3">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="space-y-1.5">
                <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {category}
                </p>
                {items.map((item) => (
                  <ChecklistItemRow key={item.id} item={item} />
                ))}
              </div>
            ))}
            <p className="text-center text-[10px] text-muted-foreground pt-1">
              Fetched {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "—"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
