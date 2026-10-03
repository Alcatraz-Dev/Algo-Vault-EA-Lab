/**
 * Pro "What Am I Missing?" View
 *
 * Actively scans for conflicting or incomplete evidence on the current chart:
 *   - HTF / LTF structure conflicts
 *   - Nearby liquidity sweeps / pools
 *   - Structure weakness or CHoCH risks
 *   - Indicator disagreement
 *   - Invalidation proximity
 *
 * Grounded strictly in empirical data from the server analytics engine.
 * Never fabricates risks.
 */
import React, { useState, useCallback } from "react";
import {
  SearchX,
  RefreshCw,
  AlertTriangle,
  Info,
  XCircle,
  ChevronDown,
  ChevronRight,
  Database,
} from "lucide-react";
import { fetchWhatAmIMissing } from "@/api/pro";
import type { MissingPoint, WhatAmIMissingResponse } from "@/types/pro";

/* ── severity config ──────────────────────────────────────────────────── */

const SEVERITY_CONFIG = {
  critical: {
    icon: <XCircle size={13} />,
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/25",
    label: "CRITICAL",
  },
  warning: {
    icon: <AlertTriangle size={13} />,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/25",
    label: "WARNING",
  },
  info: {
    icon: <Info size={13} />,
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/25",
    label: "INFO",
  },
};

const CATEGORY_LABELS: Record<MissingPoint["category"], string> = {
  htf_conflict: "HTF Conflict",
  ltf_conflict: "LTF Conflict",
  nearby_liquidity: "Nearby Liquidity",
  key_level: "Key Level",
  structure_weakness: "Structure Weakness",
  indicator_disagreement: "Indicator Disagreement",
  abnormal_volatility: "Abnormal Volatility",
  incomplete_strategy: "Incomplete Strategy",
  invalidation_proximity: "Invalidation Proximity",
  insufficient_data: "Insufficient Data",
};

function MissingPointRow({ point }: { point: MissingPoint }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = SEVERITY_CONFIG[point.severity];

  return (
    <div className={`rounded-lg border ${cfg.bg} overflow-hidden`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={cfg.color}>{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-ink leading-tight truncate">{point.title}</p>
          <p className="text-[9px] text-ink-faint">{CATEGORY_LABELS[point.category] ?? point.category}</p>
        </div>
        <span className={`text-[9px] font-bold shrink-0 ${cfg.color}`}>{cfg.label}</span>
        <span className="text-ink-faint shrink-0">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-edge/40 px-3 py-2 space-y-1.5">
          <p className="text-[10px] text-ink-mute leading-relaxed">{point.detail}</p>
          {point.evidence.length > 0 && (
            <div className="space-y-0.5 pt-0.5">
              {point.evidence.map((e, i) => (
                <div key={i} className="flex items-start gap-1">
                  <Database size={8} className="text-ink-faint mt-0.5 shrink-0" />
                  <p className="font-mono text-[9px] text-ink-faint">{e}</p>
                </div>
              ))}
            </div>
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

export function ProWhatAmIMissingView({ symbol, timeframe }: Props) {
  const [data, setData] = useState<WhatAmIMissingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWhatAmIMissing(symbol, timeframe);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  const criticalCount = data?.points.filter((p) => p.severity === "critical").length ?? 0;
  const warningCount = data?.points.filter((p) => p.severity === "warning").length ?? 0;

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-edge bg-card px-3 py-2">
        <SearchX size={13} className="text-brand-400" />
        <span className="text-[11px] font-semibold text-ink">What Am I Missing?</span>
        {data && (
          <div className="ml-auto flex items-center gap-1.5">
            {criticalCount > 0 && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-rose-500/15 text-rose-400">
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/15 text-amber-400">
                {warningCount} warnings
              </span>
            )}
          </div>
        )}
        <button
          onClick={load}
          disabled={loading || !symbol}
          className="rounded p-1 text-ink-mute hover:text-ink disabled:opacity-40 transition-colors ml-1"
          title="Re-analyze"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* idle */}
        {!data && !loading && !error && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <SearchX size={24} className="text-ink-faint" />
            <p className="text-[11px] font-medium text-ink">Conflict & Risk Scanner</p>
            <p className="max-w-[220px] text-[10px] text-ink-mute leading-relaxed">
              Actively scans for evidence you might be overlooking — HTF conflicts, nearby
              liquidity, structure weakness, and more.
            </p>
            <button
              onClick={load}
              disabled={!symbol}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-[10px] font-semibold text-white hover:bg-brand-400 disabled:opacity-40 transition-colors"
            >
              Scan Now
            </button>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="flex flex-col items-center gap-2 py-8">
            <RefreshCw size={18} className="animate-spin text-brand-400" />
            <p className="text-[10px] text-ink-mute">Scanning for blind spots…</p>
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

        {/* all clear */}
        {data && data.points.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="text-2xl">✓</span>
            <p className="text-[11px] font-medium text-emerald-400">No significant gaps found</p>
            <p className="text-[10px] text-ink-mute">
              All critical evidence appears consistent with the current read.
            </p>
          </div>
        )}

        {/* results — sorted critical → warning → info */}
        {data &&
          data.points.length > 0 &&
          !loading &&
          [...data.points]
            .sort((a, b) => {
              const order = { critical: 0, warning: 1, info: 2 };
              return order[a.severity] - order[b.severity];
            })
            .map((point) => <MissingPointRow key={point.id} point={point} />)}

        {data && (
          <p className="text-center text-[9px] text-ink-faint pt-1">
            Scanned {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "—"}
          </p>
        )}
      </div>
    </div>
  );
}
