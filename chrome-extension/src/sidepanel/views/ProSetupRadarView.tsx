/**
 * Pro Setup Radar view for the side panel.
 *
 * Fetches deterministic setup analysis from /api/extension/setup-radar,
 * which reuses the existing AlgoVault engines (market structure, liquidity,
 * momentum). No data is invented here — every verdict traces back to a
 * real calculation.
 *
 * Actions per setup card:
 *   Analyze      → AI Copilot with setup context injected
 *   Backtest     → handoff to existing AlgoVault backtesting engine
 *   Research     → handoff to AlgoVault Strategy Research
 *   Prepare Trade→ pre-fills the Execution Bridge trade ticket (no execution)
 *   Dismiss      → local hide (server record persists)
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Radar, RefreshCw, ChevronDown, ChevronUp, Target,
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2,
  ArrowRight, FlaskConical, X, Loader2, Zap,
} from "lucide-react";
import { fetchSetupRadar, dismissSetup, backtestSetup } from "@/api/pro";
import { getAlgoVaultUrl } from "@/config/environment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { SetupRadarCard, SetupRadarStatus, SetupDirection } from "@/types/pro";

interface ProSetupRadarViewProps {
  symbol: string;
  timeframe: string;
  chartContext?: unknown;
  marketContext?: unknown;
  /** Called when user wants to analyze a setup in the Copilot. */
  onAnalyzeSetup?: (setup: SetupRadarCard) => void;
  /** Called when the user wants to prepare (never execute) a trade ticket. */
  onPrepareTrade?: (setup: SetupRadarCard) => void;
}

const POLL_INTERVAL_MS = 60_000; // 1 min — setups don't change second-by-second

function statusLabel(s: SetupRadarStatus): {
  label: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
} {
  switch (s) {
    case "WAITING":      return { label: "Waiting",     color: "text-muted-foreground",   bg: "bg-secondary",          border: "border-border",              dot: "bg-muted-foreground/40" };
    case "FORMING":      return { label: "Forming",     color: "text-warning",            bg: "bg-warning/10",         border: "border-warning/30",          dot: "bg-warning" };
    case "CONFIRMATION": return { label: "Confirming",  color: "text-foreground",         bg: "bg-secondary",          border: "border-border",              dot: "bg-foreground/60" };
    case "ACTIVE":       return { label: "Active",      color: "text-positive",           bg: "bg-positive/10",        border: "border-positive/30",         dot: "bg-positive" };
    case "INVALIDATED":  return { label: "Invalidated", color: "text-negative",           bg: "bg-negative/10",        border: "border-negative/30",         dot: "bg-negative" };
    case "EXPIRED":      return { label: "Expired",     color: "text-muted-foreground", bg: "bg-secondary",         border: "border-border",              dot: "bg-muted-foreground/40" };
    default:             return { label: s,             color: "text-muted-foreground",   bg: "bg-secondary",          border: "border-border",              dot: "bg-muted-foreground/40" };
  }
}

function DirIcon({ dir }: { dir: SetupDirection }) {
  if (dir === "LONG")  return <TrendingUp size={12} className="text-positive" />;
  if (dir === "SHORT") return <TrendingDown size={12} className="text-negative" />;
  return <Minus size={12} className="text-muted-foreground" />;
}

function SetupCard({ setup, onAnalyze, onBacktest, onPrepareTrade, onDismiss }: {
  setup: SetupRadarCard;
  onAnalyze: (s: SetupRadarCard) => void;
  onBacktest: (s: SetupRadarCard) => void;
  onPrepareTrade: (s: SetupRadarCard) => void;
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

  const actionBtn = cn(
    "flex flex-1 items-center justify-center gap-1 py-1.5 text-[10px] transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:ring-inset",
    "text-muted-foreground hover:bg-secondary hover:text-foreground"
  );

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      {/* header */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <DirIcon dir={setup.direction} />
        <span className="flex-1 truncate text-xs font-semibold">{setup.setupType}</span>
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
          status.bg, status.color, status.border
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
        <button
          type="button"
          onClick={() => onDismiss(setup.id)}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
          title="Dismiss"
        >
          <X size={12} />
        </button>
      </div>

      {/* meta */}
      <div className="flex items-center gap-2 px-3 pb-2 text-[11px] text-muted-foreground">
        <span className="font-numeric font-semibold text-foreground">{setup.symbol}</span>
        <span>·</span>
        <span>{setup.timeframe}</span>
        {setup.invalidation != null && (
          <span className="flex items-center gap-1">
            <Target size={10} />
            <span className="font-numeric">{setup.invalidation}</span>
          </span>
        )}
      </div>

      {/* evidence */}
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {setup.supportingEvidence.slice(0, 2).map((e, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full border border-positive/30 bg-positive/10 px-1.5 py-0.5 text-[10px] text-positive">
            <CheckCircle2 size={9} /> {e.length > 40 ? e.slice(0, 40) + "…" : e}
          </span>
        ))}
        {setup.conflictingEvidence.slice(0, 1).map((e, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
            <AlertTriangle size={9} /> {e.length > 40 ? e.slice(0, 40) + "…" : e}
          </span>
        ))}
      </div>

      {/* expandable details */}
      {expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {setup.supportingEvidence.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Supporting evidence
              </p>
              {setup.supportingEvidence.map((e, i) => (
                <p key={i} className="flex items-start gap-1 text-[11px] text-muted-foreground">
                  <CheckCircle2 size={10} className="mt-0.5 shrink-0 text-positive" /> {e}
                </p>
              ))}
            </div>
          )}
          {setup.conflictingEvidence.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Conflicting evidence
              </p>
              {setup.conflictingEvidence.map((e, i) => (
                <p key={i} className="flex items-start gap-1 text-[11px] text-muted-foreground">
                  <AlertTriangle size={10} className="mt-0.5 shrink-0 text-warning" /> {e}
                </p>
              ))}
            </div>
          )}
          {setup.riskContext && (
            <p className="text-[11px] text-muted-foreground">{setup.riskContext}</p>
          )}
        </div>
      )}

      {/* actions */}
      <div className="flex border-t border-border">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={actionBtn}
        >
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {expanded ? "Less" : "Evidence"}
        </button>
        <span className="w-px bg-border" />
        <button type="button" onClick={() => onAnalyze(setup)} className={actionBtn}>
          <Zap size={11} /> Analyze
        </button>
        <div className="w-px bg-border" />
        <button
          type="button"
          onClick={handleBacktest}
          disabled={backtesting}
          className={cn(actionBtn, "disabled:opacity-40")}
        >
          {backtesting ? <Loader2 size={11} className="animate-spin" /> : <FlaskConical size={11} />}
          Backtest
        </button>
      </div>

      {/* research + trade preparation */}
      <div className="flex border-t border-border">
        <button
          type="button"
          onClick={() =>
            window.open(
              `${getAlgoVaultUrl()}/strategy-research?symbol=${encodeURIComponent(setup.symbol)}`,
              "_blank"
            )
          }
          className={actionBtn}
        >
          <FlaskConical size={11} /> Research
        </button>
        <div className="w-px bg-border" />
        <button
          type="button"
          onClick={() => onPrepareTrade(setup)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1 py-1.5 text-[10px] font-semibold transition-colors",
            "text-brand hover:bg-brand/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:ring-inset"
          )}
          title="Prepare a trade ticket from this setup — nothing is executed until you confirm"
        >
          <ArrowRight size={11} /> Prepare Trade
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
  onPrepareTrade,
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

  const handlePrepareTrade = useCallback((setup: SetupRadarCard) => {
    onPrepareTrade?.(setup);
  }, [onPrepareTrade]);

  const handleBacktest = useCallback(async (setup: SetupRadarCard) => {
    // No-op here — handled inside SetupCard
    void setup;
  }, []);

  const visible = setups.filter((s) => !dismissed.has(s.id));
  const activeCount = visible.filter((s) => s.status === "ACTIVE" || s.status === "CONFIRMATION" || s.status === "FORMING").length;

  if (loading && setups.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-secondary">
          <Radar size={18} className="text-muted-foreground" />
        </div>
        <p className="text-[11px] text-muted-foreground">Scanning for setups…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Radar size={13} className="text-muted-foreground" />
          <span className="text-xs font-semibold">Setup Radar</span>
          {activeCount > 0 && (
            <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {activeCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {fetchedAt && (
            <span className="font-numeric text-[10px] text-muted-foreground">
              {Math.round((Date.now() - fetchedAt) / 1000)}s ago
            </span>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* error */}
      {error && (
        <div className="px-3 pt-3">
          <Alert variant="destructive" className="py-2">
            <AlertTriangle size={12} />
            <AlertDescription className="text-[11px]">{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* setup list */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {visible.map((setup) => (
          <SetupCard
            key={setup.id}
            setup={setup}
            onAnalyze={handleAnalyze}
            onBacktest={handleBacktest}
            onPrepareTrade={handlePrepareTrade}
            onDismiss={handleDismiss}
          />
        ))}
      </div>

      <p className="px-3 pb-2 text-[10px] text-muted-foreground">
        Setup Radar uses deterministic evidence — not probability estimates. Backtesting is historical analysis only.
      </p>
    </div>
  );
}
