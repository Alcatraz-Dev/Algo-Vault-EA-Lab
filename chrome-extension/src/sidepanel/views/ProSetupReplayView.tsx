/**
 * Pro Historical Setup Replay View
 *
 * Finds historical setups that match the current market conditions and shows
 * how they resolved. Helps traders validate the current setup against past
 * analogues without any fabricated win-probability claims.
 *
 * Every match explicitly shows similarity reasons, outcome, and disclaimer.
 */
import React, { useState, useCallback } from "react";
import {
  History,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { fetchSetupReplay } from "@/api/pro";
import type { HistoricalMatch, SetupReplayResponse } from "@/types/pro";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* ── helpers ──────────────────────────────────────────────────────────── */

const OUTCOME_CONFIG = {
  "Target Reached": {
    color: "text-positive",
    bg: "bg-positive/15 border-positive/30",
    dot: "bg-positive",
  },
  Invalidated: {
    color: "text-negative",
    bg: "bg-negative/10 border-negative/30",
    dot: "bg-negative",
  },
  Partial: {
    color: "text-warning",
    bg: "bg-warning/10 border-warning/30",
    dot: "bg-warning",
  },
  Expired: {
    color: "text-muted-foreground",
    bg: "bg-secondary border-border",
    dot: "bg-muted-foreground/40",
  },
};

function SimilarityBar({ score }: { score: number }) {
  const color =
    score >= 75 ? "bg-positive" : score >= 55 ? "bg-warning" : "bg-negative";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`font-numeric text-[10px] font-bold ${score >= 75 ? "text-positive" : score >= 55 ? "text-warning" : "text-negative"}`}>
        {score}%
      </span>
    </div>
  );
}

function MatchCard({ match }: { match: HistoricalMatch }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = OUTCOME_CONFIG[match.outcomeClassification] ?? OUTCOME_CONFIG.Expired;

  return (
    <div className={`rounded-xl border ${cfg.bg} overflow-hidden`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground leading-tight">{match.setupName}</p>
          <p className="text-[10px] text-muted-foreground">{match.dateLabel}</p>
        </div>
        <span className={`text-[10px] font-bold shrink-0 ${cfg.color}`}>
          {match.outcomeClassification}
        </span>
        <span className="text-muted-foreground shrink-0">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2.5 space-y-2.5">
          {/* similarity */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
              Similarity Score
            </p>
            <SimilarityBar score={match.similarityScore} />
          </div>
          {/* conditions */}
          {match.conditions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                Matched Conditions
              </p>
              <div className="space-y-0.5">
                {match.conditions.map((c, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground">· {c}</p>
                ))}
              </div>
            </div>
          )}
          {/* why similar */}
          {match.similarityReasons.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                Why Similar
              </p>
              {match.similarityReasons.map((r, i) => (
                <p key={i} className="text-[10px] text-muted-foreground">· {r}</p>
              ))}
            </div>
          )}
          {/* subsequent movement */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
              What Happened
            </p>
            <p className="text-[10px] text-foreground leading-relaxed">{match.subsequentMovement}</p>
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

export function ProSetupReplayView({ symbol, timeframe }: Props) {
  const [data, setData] = useState<SetupReplayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSetupReplay(symbol, timeframe);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <History size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Historical Replay</span>
        {data && (
          <span className="ml-auto font-numeric text-[10px] text-muted-foreground">
            {data.historicalMatches.length} match{data.historicalMatches.length !== 1 ? "es" : ""}
          </span>
        )}
        <button
          onClick={load}
          disabled={loading || !symbol}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 ml-1"
          title="Find historical analogues"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {/* idle */}
        {!data && !loading && !error && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <History size={24} className="text-muted-foreground" />
            <p className="text-[11px] font-medium text-foreground">Setup Replay</p>
            <p className="max-w-[220px] text-[10px] text-muted-foreground leading-relaxed">
              Finds historical setups similar to current {symbol || "chart"} conditions and shows
              how they resolved — with no fabricated statistics.
            </p>
            <Button
              variant="brand"
              size="sm"
              onClick={load}
              disabled={!symbol}
              className="text-[11px]"
            >
              Find Analogues
            </Button>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="flex flex-col items-center gap-2 py-8">
            <RefreshCw size={18} className="animate-spin text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground">Searching historical setups…</p>
          </div>
        )}

        {/* error */}
        {error && !loading && (
          <Alert variant="destructive">
            <AlertCircle size={12} />
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

        {data && !loading && (
          <>
            {/* current setup summary */}
            <div className="rounded-xl border border-border bg-secondary px-3 py-2.5 space-y-1">
              <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Current Setup
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-foreground">{data.currentSetup.type}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                  data.currentSetup.bias === "bullish"
                    ? "bg-positive/10 border-positive/30 text-positive"
                    : data.currentSetup.bias === "bearish"
                    ? "bg-negative/10 border-negative/30 text-negative"
                    : "bg-secondary border-border text-muted-foreground"
                }`}>
                  {data.currentSetup.bias.toUpperCase()}
                </span>
              </div>
              {data.currentSetup.conditions.length > 0 && (
                <div className="space-y-0.5 pt-0.5">
                  {data.currentSetup.conditions.slice(0, 4).map((c, i) => (
                    <p key={i} className="text-[10px] text-muted-foreground">· {c}</p>
                  ))}
                </div>
              )}
            </div>

            {/* no matches */}
            {data.historicalMatches.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Minus size={20} className="text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">No strong historical analogues found</p>
              </div>
            )}

            {/* match cards */}
            {data.historicalMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}

            {/* disclaimer */}
            <div className="flex items-start gap-1.5 rounded-xl border border-border bg-secondary px-3 py-2">
              <AlertCircle size={10} className="text-warning mt-0.5 shrink-0" />
              <p className="text-[10px] text-muted-foreground leading-relaxed">{data.disclaimer}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
