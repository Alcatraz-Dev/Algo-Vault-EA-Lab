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


/* ── helpers ──────────────────────────────────────────────────────────── */

const STATUS_CONFIG = {
  confirmed: {
    icon: <CheckCircle2 size={13} />,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/25",
    label: "CONFIRMED",
  },
  warning: {
    icon: <AlertTriangle size={13} />,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/25",
    label: "WARNING",
  },
  failed: {
    icon: <XCircle size={13} />,
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/25",
    label: "FAILED",
  },
  unresolved: {
    icon: <Clock size={13} />,
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/25",
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
    <div className={`rounded-lg border ${cfg.bg} overflow-hidden`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={cfg.color}>{cfg.icon}</span>
        <span className="flex-1 text-[11px] font-medium text-ink leading-tight">{item.title}</span>
        <span className={`text-[9px] font-bold tracking-wider ${cfg.color}`}>{cfg.label}</span>
        <span className="text-ink-faint">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-edge/40 px-3 py-2 space-y-1.5">
          <p className="text-[10px] text-ink-mute leading-relaxed">{item.explanation}</p>
          {item.unresolvedReason && (
            <p className="text-[10px] text-sky-400 italic">{item.unresolvedReason}</p>
          )}
          {item.rawEvidence && item.rawEvidence.length > 0 && (
            <div className="space-y-0.5">
              {item.rawEvidence.map((e, i) => (
                <p key={i} className="font-mono text-[9px] text-ink-faint">
                  · {e}
                </p>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 pt-0.5">
            <Database size={8} className="text-ink-faint" />
            <span className="text-[9px] text-ink-faint">{item.evidenceSource}</span>
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
      ? "text-ink-mute"
      : passRate >= 80
      ? "text-emerald-400"
      : passRate >= 60
      ? "text-amber-400"
      : "text-rose-400";

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-edge bg-card px-3 py-2">
        <ClipboardList size={13} className="text-brand-400" />
        <span className="text-[11px] font-semibold text-ink">Pre-Trade Checklist</span>
        {data && (
          <span className={`ml-auto text-[11px] font-bold tabular-nums ${passColor}`}>
            {data.passedCount}/{data.totalCount} passed
          </span>
        )}
        <button
          onClick={load}
          disabled={loading || !symbol}
          className="rounded p-1 text-ink-mute hover:text-ink disabled:opacity-40 transition-colors"
          title="Run checklist"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* progress bar */}
        {data && (
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  passRate! >= 80
                    ? "bg-emerald-400"
                    : passRate! >= 60
                    ? "bg-amber-400"
                    : "bg-rose-400"
                }`}
                style={{ width: `${passRate}%` }}
              />
            </div>
            <p className={`text-[9px] font-semibold text-right tabular-nums ${passColor}`}>
              {passRate}% conditions met
            </p>
          </div>
        )}

        {/* Evidence Score Visualization */}
        {evidenceScore && (
          <div className="rounded-lg border border-edge bg-card p-2.5 space-y-2">
            <div className="flex items-center justify-between border-b border-edge/40 pb-1.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-ink">
                <BarChart3 size={11} className="text-brand-400" /> EVIDENCE SCORE
              </span>
              <span className="text-[8px] text-ink-faint">Condition Alignment</span>
            </div>
            <div className="space-y-1.5">
              {evidenceScore.categories.map((c) => {
                const filled = c.score;
                const total = c.maxScore;
                const pct = Math.round((filled / total) * 100);
                const barColor =
                  filled >= 8 ? "bg-emerald-400" : filled >= 6 ? "bg-amber-400" : "bg-rose-400";
                return (
                  <div key={c.name} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="font-mono font-semibold text-ink-mute">{c.name}</span>
                      <span className="text-ink-faint">{c.label} ({filled}/{total})</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[8px] italic text-ink-faint leading-tight">
              {evidenceScore.disclaimer}
            </p>
          </div>
        )}

        {/* idle state */}
        {!data && !loading && !error && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <ClipboardList size={24} className="text-ink-faint" />
            <p className="text-[11px] font-medium text-ink">Run Pre-Trade Checklist</p>
            <p className="max-w-[220px] text-[10px] text-ink-mute leading-relaxed">
              Evaluates {symbol || "current symbol"} against deterministic market structure,
              liquidity, and strategy conditions.
            </p>
            <button
              onClick={load}
              disabled={!symbol}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-[10px] font-semibold text-white hover:bg-brand-400 disabled:opacity-40 transition-colors"
            >
              Run Checklist
            </button>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="flex flex-col items-center gap-2 py-8">
            <RefreshCw size={18} className="animate-spin text-brand-400" />
            <p className="text-[10px] text-ink-mute">Evaluating conditions…</p>
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

        {/* grouped items */}
        {data && !loading && (
          <div className="space-y-3">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="space-y-1.5">
                <p className="text-[9px] font-bold tracking-widest text-ink-faint uppercase">
                  {category}
                </p>
                {items.map((item) => (
                  <ChecklistItemRow key={item.id} item={item} />
                ))}
              </div>
            ))}
            <p className="text-center text-[9px] text-ink-faint pt-1">
              Fetched {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "—"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
