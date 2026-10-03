/**
 * Pro Setup Radar view for the side panel.
 *
 * Fetches deterministic setup analysis from /api/extension/setup-radar,
 * which reuses the existing AlgoVault engines (market structure, liquidity,
 * momentum). No data is invented here — every verdict traces back to a
 * real calculation.
 *
 * Actions per setup card:
 *   Analyze → AI Copilot with setup context injected
 *   Backtest → handoff to existing AlgoVault backtesting engine
 *   Dismiss  → local hide (server record persists)
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Radar, RefreshCw, ChevronDown, ChevronUp, Target,
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2,
  ArrowRight, FlaskConical, X, Loader2, Zap,
} from "lucide-react";
import { fetchSetupRadar, dismissSetup, backtestSetup } from "@/api/pro";
import { getAlgoVaultUrl } from "@/config/environment";
import type { SetupRadarCard, SetupRadarStatus, SetupDirection } from "@/types/pro";

interface ProSetupRadarViewProps {
  symbol: string;
  timeframe: string;
  chartContext?: unknown;
  marketContext?: unknown;
  /** Called when user wants to analyze a setup in the Copilot. */
  onAnalyzeSetup?: (setup: SetupRadarCard) => void;
}

const POLL_INTERVAL_MS = 60_000; // 1 min — setups don't change second-by-second

function statusLabel(s: SetupRadarStatus): { label: string; color: string; bg: string; dot: string } {
  switch (s) {
    case "WAITING":      return { label: "Waiting",     color: "text-ink-mute",      bg: "bg-raised",          dot: "bg-ink-faint" };
    case "FORMING":      return { label: "Forming",     color: "text-amber-400",     bg: "bg-amber-500/10",    dot: "bg-amber-400 animate-pulse-dot" };
    case "CONFIRMATION": return { label: "Confirming",  color: "text-blue-400",      bg: "bg-blue-500/10",     dot: "bg-blue-400 animate-pulse-dot" };
    case "ACTIVE":       return { label: "Active",      color: "text-emerald-400",   bg: "bg-emerald-500/10",  dot: "bg-emerald-400 animate-pulse-dot" };
    case "INVALIDATED":  return { label: "Invalidated", color: "text-rose-400",      bg: "bg-rose-500/10",     dot: "bg-rose-500" };
    case "EXPIRED":      return { label: "Expired",     color: "text-ink-faint",     bg: "bg-raised",          dot: "bg-ink-faint" };
    default:             return { label: s,             color: "text-ink-mute",      bg: "bg-raised",          dot: "bg-ink-faint" };
  }
}

function DirIcon({ dir }: { dir: SetupDirection }) {
  if (dir === "LONG")  return <TrendingUp size={12} className="text-emerald-400" />;
  if (dir === "SHORT") return <TrendingDown size={12} className="text-rose-400" />;
  return <Minus size={12} className="text-ink-faint" />;
}

function SetupCard({ setup, onAnalyze, onBacktest, onDismiss }: {
  setup: SetupRadarCard;
  onAnalyze: (s: SetupRadarCard) => void;
  onBacktest: (s: SetupRadarCard) => void;
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const status = statusLabel(setup.status);

  const handleBacktest = async () => {
    if (backtesting) return;
    setBacktesting(true);
    try {
      const result = await backtestSetup(setup.id, setup.symbol, setup.timeframe);
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
      else window.open(`${getAlgoVaultUrl()}/backtests`, "_blank", "noopener,noreferrer");
    } catch {
      window.open(`${getAlgoVaultUrl()}/backtests`, "_blank", "noopener,noreferrer");
    } finally {
      setBacktesting(false);
    }
  };

  return (
    <article className="rounded-xl border border-edge bg-card overflow-hidden animate-fade-in">
      {/* header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <DirIcon dir={setup.direction} />
        <span className="text-xs font-semibold flex-1 truncate">{setup.setupType}</span>
        <span className={`inline-flex items-center gap-1 rounded-full border border-transparent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${status.bg} ${status.color}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
        <button onClick={() => onDismiss(setup.id)} className="rounded p-0.5 text-ink-faint hover:text-ink" title="Dismiss">
          <X size={11} />
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 text-[10px] text-ink-mute">
          <span className="font-mono font-semibold text-ink">{setup.symbol}</span>
          <span>·</span>
          <span>{setup.timeframe}</span>
          {setup.invalidation != null && (
            <>
              <span>·</span>
              <span className="flex items-center gap-0.5"><Target size={9} /> Inv: {setup.invalidation.toFixed(setup.invalidation < 1 ? 5 : 2)}</span>
            </>
          )}
        </div>
      </div>

      {/* evidence summary */}
      <div className="px-3 pb-2 flex flex-wrap gap-1">
        {setup.supportingEvidence.slice(0, 2).map((e, i) => (
          <span key={i} className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-400">
            <CheckCircle2 size={8} /> {e.length > 40 ? e.slice(0, 40) + "…" : e}
          </span>
        ))}
        {setup.conflictingEvidence.slice(0, 1).map((e, i) => (
          <span key={i} className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-400">
            <AlertTriangle size={8} /> {e.length > 40 ? e.slice(0, 40) + "…" : e}
          </span>
        ))}
      </div>

      {/* expandable details */}
      {expanded && (
        <div className="border-t border-edge/50 px-3 py-2 space-y-2 animate-fade-in">
          {setup.supportingEvidence.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-ink-faint mb-1">Supporting evidence</p>
              {setup.supportingEvidence.map((e, i) => (
                <p key={i} className="text-[10px] text-emerald-400 flex items-start gap-1">
                  <CheckCircle2 size={9} className="mt-0.5 shrink-0" /> {e}
                </p>
              ))}
            </div>
          )}
          {setup.conflictingEvidence.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-ink-faint mb-1">Conflicting evidence</p>
              {setup.conflictingEvidence.map((e, i) => (
                <p key={i} className="text-[10px] text-amber-400 flex items-start gap-1">
                  <AlertTriangle size={9} className="mt-0.5 shrink-0" /> {e}
                </p>
              ))}
            </div>
          )}
          {setup.riskContext && (
            <p className="text-[10px] text-ink-mute">{setup.riskContext}</p>
          )}
        </div>
      )}

      {/* actions */}
      <div className="border-t border-edge/50 flex">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] text-ink-mute hover:text-ink hover:bg-raised/50 transition-colors"
        >
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          {expanded ? "Less" : "Evidence"}
        </button>
        <div className="w-px bg-edge/50" />
        <button
          onClick={() => onAnalyze(setup)}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] text-brand-400 hover:text-brand-300 hover:bg-brand-500/5 transition-colors"
        >
          <Zap size={10} /> Analyze
        </button>
        <div className="w-px bg-edge/50" />
        <button
          onClick={handleBacktest}
          disabled={backtesting}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] text-ink-mute hover:text-ink hover:bg-raised/50 transition-colors disabled:opacity-40"
        >
          {backtesting ? <Loader2 size={10} className="animate-spin" /> : <FlaskConical size={10} />}
          Backtest
        </button>
      </div>
    </article>
  );
}

export function ProSetupRadarView({
  symbol,
  timeframe,
  chartContext,
  marketContext,
  onAnalyzeSetup,
}: ProSetupRadarViewProps) {
  const [setups, setSetups] = useState<SetupRadarCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await fetchSetupRadar({ symbol, timeframe, chartContext, marketContext });
      setSetups(snap.setups);
      setFetchedAt(snap.fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch setups");
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, chartContext, marketContext]);

  useEffect(() => {
    void load();
    pollRef.current = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const handleDismiss = useCallback(async (id: string) => {
    setDismissed((s) => new Set([...s, id]));
    try { await dismissSetup(id); } catch { /* best-effort */ }
  }, []);

  const handleAnalyze = useCallback((setup: SetupRadarCard) => {
    onAnalyzeSetup?.(setup);
  }, [onAnalyzeSetup]);

  const handleBacktest = useCallback(async (setup: SetupRadarCard) => {
    // No-op here — handled inside SetupCard
    void setup;
  }, []);

  const visible = setups.filter((s) => !dismissed.has(s.id));
  const activeCount = visible.filter((s) => s.status === "ACTIVE" || s.status === "CONFIRMATION" || s.status === "FORMING").length;

  if (loading && setups.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-3">
        <div className="relative flex h-10 w-10 items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-brand-500/30 animate-ping" />
          <Radar size={18} className="text-brand-500" />
        </div>
        <p className="text-[10px] text-ink-mute">Scanning for setups…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-edge/50">
        <div className="flex items-center gap-1.5">
          <Radar size={12} className="text-brand-500" />
          <span className="text-xs font-semibold">Setup Radar</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-brand-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-brand-300">
              {activeCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {fetchedAt && (
            <span className="text-[9px] text-ink-faint">
              {Math.round((Date.now() - fetchedAt) / 1000)}s ago
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="rounded p-1 text-ink-mute hover:text-ink disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* error */}
      {error && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-[10px] text-rose-400">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* setups list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {visible.length === 0 && !loading && !error && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Radar size={24} className="text-ink-faint" />
            <p className="text-xs font-medium text-ink">No setups detected</p>
            <p className="max-w-[200px] text-[10px] leading-relaxed text-ink-mute">
              The radar monitors {symbol} on {timeframe}. Setups appear when market conditions align with the connected strategies.
            </p>
          </div>
        )}
        {visible.map((setup) => (
          <SetupCard
            key={setup.id}
            setup={setup}
            onAnalyze={handleAnalyze}
            onBacktest={handleBacktest}
            onDismiss={handleDismiss}
          />
        ))}
      </div>

      <p className="px-3 pb-2 text-[8px] text-ink-faint">
        Setup Radar uses deterministic evidence — not probability estimates. Backtesting is historical analysis only.
      </p>
    </div>
  );
}
