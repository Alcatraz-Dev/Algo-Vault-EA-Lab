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
  CheckCircle2,
  Info,
  XCircle,
  ChevronDown,
  ChevronRight,
  Database,
} from "lucide-react";
import { fetchWhatAmIMissing } from "@/api/pro";
import type { MissingPoint, WhatAmIMissingResponse } from "@/types/pro";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

/* ── severity config ──────────────────────────────────────────────────── */

const SEVERITY_CONFIG = {
  critical: {
    icon: <XCircle size={13} />,
    color: "text-negative",
    bg: "bg-negative/10 border-negative/30",
    label: "CRITICAL",
  },
  warning: {
    icon: <AlertTriangle size={13} />,
    color: "text-warning",
    bg: "bg-warning/10 border-warning/30",
    label: "WARNING",
  },
  info: {
    icon: <Info size={13} />,
    color: "text-muted-foreground",
    bg: "bg-secondary border-border",
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
    <div className={`rounded-xl border ${cfg.bg} overflow-hidden`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={cfg.color}>{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground leading-tight truncate">{point.title}</p>
          <p className="text-[10px] text-muted-foreground">{CATEGORY_LABELS[point.category] ?? point.category}</p>
        </div>
        <span className={`text-[10px] font-bold shrink-0 ${cfg.color}`}>{cfg.label}</span>
        <span className="text-muted-foreground shrink-0">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          <p className="text-[10px] text-muted-foreground leading-relaxed">{point.detail}</p>
          {point.evidence.length > 0 && (
            <div className="space-y-0.5 pt-0.5">
              {point.evidence.map((e, i) => (
                <div key={i} className="flex items-start gap-1">
                  <Database size={10} className="text-muted-foreground mt-0.5 shrink-0" />
                  <p className="font-numeric text-[10px] text-muted-foreground">{e}</p>
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
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <SearchX size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">What Am I Missing?</span>
        {data && (
          <div className="ml-auto flex items-center gap-1.5">
            {criticalCount > 0 && (
              <Badge variant="destructive" className="px-1.5 font-numeric text-[10px] font-bold">
                {criticalCount} critical
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="warning" className="px-1.5 font-numeric text-[10px] font-bold">
                {warningCount} warnings
              </Badge>
            )}
          </div>
        )}
        <button
          onClick={load}
          disabled={loading || !symbol}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 ml-1"
          title="Re-analyze"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* idle */}
        {!data && !loading && !error && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <SearchX size={24} className="text-muted-foreground" />
            <p className="text-[11px] font-medium text-foreground">Conflict & Risk Scanner</p>
            <p className="max-w-[220px] text-[10px] text-muted-foreground leading-relaxed">
              Actively scans for evidence you might be overlooking — HTF conflicts, nearby
              liquidity, structure weakness, and more.
            </p>
            <Button
              variant="brand"
              size="sm"
              onClick={load}
              disabled={!symbol}
              className="text-[11px]"
            >
              Scan Now
            </Button>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="flex flex-col items-center gap-2 py-8">
            <RefreshCw size={18} className="animate-spin text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground">Scanning for blind spots…</p>
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

        {/* all clear */}
        {data && data.points.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-positive/30 bg-positive/10">
              <CheckCircle2 size={16} className="text-positive" />
            </span>
            <p className="text-[11px] font-medium text-positive">No significant gaps found</p>
            <p className="text-[10px] text-muted-foreground">
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
          <p className="text-center text-[10px] text-muted-foreground pt-1">
            Scanned {data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "—"}
          </p>
        )}
      </div>
    </div>
  );
}
