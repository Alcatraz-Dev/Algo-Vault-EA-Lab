/**
 * Pro Smart Alerts view for the side panel.
 *
 * Fetches deterministic market alerts from /api/extension/smart-alerts.
 * Every alert is derived from a real indicator condition — liquidity sweeps,
 * EMA alignment, RSI extremes, structure breaks. No events are invented.
 *
 * The AI layer in the server route prioritises and explains; it never
 * fabricates market data.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Bell, RefreshCw, AlertTriangle, Info, Check,
  CheckCircle2, Zap, Loader2, Clock,
} from "lucide-react";
import { fetchSmartAlerts, markAlertRead } from "@/api/pro";
import type { SmartAlert, AlertSeverity } from "@/types/pro";

interface ProSmartAlertsViewProps {
  symbol: string;
  timeframe: string;
}

const POLL_INTERVAL_MS = 30_000; // 30s — alerts should be reasonably fresh

function severityStyle(severity: AlertSeverity): { border: string; icon: React.ReactNode; badge: string } {
  switch (severity) {
    case "critical": return {
      border: "border-negative/30",
      badge: "border border-negative/30 bg-negative/10 text-negative",
      icon: <AlertTriangle size={12} className="text-negative" />,
    };
    case "warning": return {
      border: "border-warning/30",
      badge: "border border-warning/30 bg-warning/10 text-warning",
      icon: <AlertTriangle size={12} className="text-warning" />,
    };
    case "info": return {
      border: "border-border",
      badge: "border border-border bg-secondary text-foreground",
      icon: <Info size={12} className="text-muted-foreground" />,
    };
    default: return {
      border: "border-border",
      badge: "border border-border bg-secondary text-muted-foreground",
      icon: <Info size={12} className="text-muted-foreground" />,
    };
  }
}

function timeAgo(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function AlertCard({ alert, onAck }: { alert: SmartAlert; onAck: (id: string) => void }) {
  const [acking, setAcking] = useState(false);
  const style = severityStyle(alert.severity);

  const handleAck = async () => {
    if (acking) return;
    setAcking(true);
    try { await markAlertRead(alert.id); } catch { /* best-effort */ }
    onAck(alert.id);
  };

  return (
    <article className={`space-y-2 rounded-xl border ${style.border} bg-card p-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {style.icon}
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-tight">{alert.title}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{alert.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAck}
          disabled={acking}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:opacity-40"
          title="Mark read"
        >
          {acking ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
        </button>
      </div>

      {/* evidence */}
      {alert.evidence && alert.evidence.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {alert.evidence.slice(0, 3).map((e, i) => (
            <span key={i} className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {e.length > 50 ? e.slice(0, 50) + "…" : e}
            </span>
          ))}
        </div>
      )}

      {/* footer */}
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style.badge}`}>
          {alert.category}
        </span>
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Clock size={9} /> {timeAgo(alert.createdAt)}
        </span>
      </div>
    </article>
  );
}

export function ProSmartAlertsView({ symbol, timeframe }: ProSmartAlertsViewProps) {
  const [alerts, setAlerts] = useState<SmartAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (force = false) => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const since = force ? undefined : fetchedAt ?? undefined;
      const fresh = await fetchSmartAlerts(symbol, timeframe, since);
      setAlerts((prev) => {
        const ids = new Set(prev.map((a) => a.id));
        const merged = [...prev, ...fresh.filter((a) => !ids.has(a.id))];
        // Keep the last 50, sorted by priority desc then createdAt desc
        return merged
          .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt)
          .slice(0, 50);
      });
      setFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch alerts");
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, fetchedAt]);

  useEffect(() => {
    void load(true);
    pollRef.current = setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

  const handleAck = useCallback((id: string) => {
    setReadIds((s) => new Set([...s, id]));
  }, []);

  const visible = alerts.filter((a) => !readIds.has(a.id));
  const unreadCount = visible.length;

  if (loading && alerts.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">Checking for alerts…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Bell size={13} className="text-muted-foreground" />
          <span className="text-xs font-semibold">Smart Alerts</span>
          {unreadCount > 0 && (
            <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 font-numeric text-[10px] font-bold text-muted-foreground">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {fetchedAt && (
            <span className="font-numeric text-[10px] text-muted-foreground">{timeAgo(fetchedAt)}</span>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {visible.length === 0 && !loading && !error && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-positive/30 bg-positive/10">
              <Check size={18} className="text-positive" />
            </div>
            <p className="text-xs font-medium text-foreground">No alerts right now</p>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-muted-foreground">
              Smart Alerts watches {symbol} on {timeframe} for liquidity sweeps, EMA alignment, RSI extremes, and structure breaks.
            </p>
          </div>
        )}
        {visible.map((alert) => (
          <AlertCard key={alert.id} alert={alert} onAck={handleAck} />
        ))}
      </div>

      <p className="px-3 pb-2 text-[10px] text-muted-foreground">
        All alerts are deterministic. Alerts are derived from real indicator conditions — not AI speculation.
      </p>
    </div>
  );
}
