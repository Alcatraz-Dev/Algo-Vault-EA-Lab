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

/* ── helpers ──────────────────────────────────────────────────────────── */

const OUTCOME_CONFIG = {
  "Target Reached": {
    color: "text-emerald-400",
    bg: "bg-emerald-500/15 border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  Invalidated: {
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/25",
    dot: "bg-rose-400",
  },
  Partial: {
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/25",
    dot: "bg-amber-400",
  },
  Expired: {
    color: "text-ink-faint",
    bg: "bg-raised border-edge",
    dot: "bg-ink-faint",
  },
};

function SimilarityBar({ score }: { score: number }) {
  const color =
    score >= 75 ? "bg-emerald-400" : score >= 55 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 flex-1 rounded-full bg-raised overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`text-[9px] font-bold tabular-nums ${
        score >= 75 ? "text-emerald-400" : score >= 55 ? "text-amber-400" : "text-rose-400"
      }`}>
        {score}%
      </span>
    </div>
  );
}

function MatchCard({ match }: { match: HistoricalMatch }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = OUTCOME_CONFIG[match.outcomeClassification] ?? OUTCOME_CONFIG.Expired;

  return (
    <div className={`rounded-lg border ${cfg.bg} overflow-hidden`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-ink leading-tight">{match.setupName}</p>
          <p className="text-[9px] text-ink-faint">{match.dateLabel}</p>
        </div>
        <span className={`text-[9px] font-bold shrink-0 ${cfg.color}`}>
          {match.outcomeClassification}
        </span>
        <span className="text-ink-faint shrink-0">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-edge/40 px-3 py-2.5 space-y-2.5">
          {/* similarity */}
          <div>
            <p className="text-[9px] font-semibold text-ink-faint mb-1 uppercase tracking-wider">
              Similarity Score
            </p>
            <SimilarityBar score={match.similarityScore} />
          </div>
          {/* conditions */}
          {match.conditions.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-ink-faint mb-1 uppercase tracking-wider">
                Matched Conditions
              </p>
              <div className="space-y-0.5">
                {match.conditions.map((c, i) => (
                  <p key={i} className="text-[10px] text-ink-mute">· {c}</p>
                ))}
              </div>
            </div>
          )}
          {/* why similar */}
          {match.similarityReasons.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-ink-faint mb-1 uppercase tracking-wider">
                Why Similar
              </p>
              {match.similarityReasons.map((r, i) => (
                <p key={i} className="text-[10px] text-ink-mute">· {r}</p>
              ))}
            </div>
          )}
          {/* subsequent movement */}
          <div>
            <p className="text-[9px] font-semibold text-ink-faint mb-1 uppercase tracking-wider">
              What Happened
            </p>
            <p className="text-[10px] text-ink leading-relaxed">{match.subsequentMovement}</p>
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
      <div className="flex items-center gap-2 border-b border-edge bg-card px-3 py-2">
        <History size={13} className="text-brand-400" />
        <span className="text-[11px] font-semibold text-ink">Historical Replay</span>
        {data && (
          <span className="ml-auto text-[10px] text-ink-mute tabular-nums">
            {data.historicalMatches.length} match{data.historicalMatches.length !== 1 ? "es" : ""}
          </span>
        )}
        <button
          onClick={load}
          disabled={loading || !symbol}
          className="rounded p-1 text-ink-mute hover:text-ink disabled:opacity-40 transition-colors ml-1"
          title="Find historical analogues"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {/* idle */}
        {!data && !loading && !error && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <History size={24} className="text-ink-faint" />
            <p className="text-[11px] font-medium text-ink">Setup Replay</p>
            <p className="max-w-[220px] text-[10px] text-ink-mute leading-relaxed">
              Finds historical setups similar to current {symbol || "chart"} conditions and shows
              how they resolved — with no fabricated statistics.
            </p>
            <button
              onClick={load}
              disabled={!symbol}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-[10px] font-semibold text-white hover:bg-brand-400 disabled:opacity-40 transition-colors"
            >
              Find Analogues
            </button>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="flex flex-col items-center gap-2 py-8">
            <RefreshCw size={18} className="animate-spin text-brand-400" />
            <p className="text-[10px] text-ink-mute">Searching historical setups…</p>
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

        {data && !loading && (
          <>
            {/* current setup summary */}
            <div className="rounded-lg border border-edge bg-raised px-3 py-2.5 space-y-1">
              <p className="text-[9px] font-bold tracking-widest text-ink-faint uppercase">
                Current Setup
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-ink">{data.currentSetup.type}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                  data.currentSetup.bias === "bullish"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : data.currentSetup.bias === "bearish"
                    ? "bg-rose-500/15 text-rose-400"
                    : "bg-raised text-ink-mute"
                }`}>
                  {data.currentSetup.bias.toUpperCase()}
                </span>
              </div>
              {data.currentSetup.conditions.length > 0 && (
                <div className="space-y-0.5 pt-0.5">
                  {data.currentSetup.conditions.slice(0, 4).map((c, i) => (
                    <p key={i} className="text-[9px] text-ink-mute">· {c}</p>
                  ))}
                </div>
              )}
            </div>

            {/* no matches */}
            {data.historicalMatches.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Minus size={20} className="text-ink-faint" />
                <p className="text-[10px] text-ink-mute">No strong historical analogues found</p>
              </div>
            )}

            {/* match cards */}
            {data.historicalMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}

            {/* disclaimer */}
            <div className="flex items-start gap-1.5 rounded-lg border border-edge bg-raised px-3 py-2">
              <AlertCircle size={10} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[9px] text-ink-faint leading-relaxed">{data.disclaimer}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
