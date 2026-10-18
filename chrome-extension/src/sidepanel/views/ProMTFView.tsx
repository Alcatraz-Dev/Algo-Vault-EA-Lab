import React, { useEffect, useState } from "react";
import { fetchMTFIntelligence } from "@/api/pro";
import type { MTFResponse, MTFRow } from "@/types/pro";
import { RefreshCwIcon, AlertTriangleIcon, LayersIcon } from "lucide-react";

interface ProMTFViewProps {
  symbol: string;
  timeframe: string;
}

export const ProMTFView: React.FC<ProMTFViewProps> = ({ symbol, timeframe }) => {
  const [data, setData] = useState<MTFResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadMTF = async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMTFIntelligence(symbol, timeframe || "1H");
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MTF data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMTF();
  }, [symbol, timeframe]);

  const getStateBadge = (state: MTFRow["state"]) => {
    switch (state) {
      case "BULLISH":
        return "bg-positive/10 text-positive border-positive/30";
      case "BEARISH":
        return "bg-negative/10 text-negative border-negative/30";
      case "RANGE":
        return "bg-secondary text-muted-foreground border-border";
      case "TRANSITION":
        return "bg-warning/10 text-warning border-warning/30";
      default:
        return "bg-secondary text-muted-foreground border-border";
    }
  };

  return (
    <div className="flex h-full flex-col space-y-3 overflow-y-auto bg-background p-3 text-xs text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center space-x-2">
          <LayersIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold tracking-wide">MTF Intelligence</span>
          <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 font-numeric text-[10px] text-muted-foreground">
            {symbol || "NO SYMBOL"}
          </span>
        </div>
        <button
          type="button"
          onClick={loadMTF}
          disabled={loading}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:opacity-50"
          title="Refresh MTF matrix"
        >
          <RefreshCwIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center space-x-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-destructive">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="flex flex-col items-center justify-center space-y-2 py-12 text-muted-foreground">
          <RefreshCwIcon className="h-5 w-5 animate-spin text-muted-foreground" />
          <span>Analyzing multi-timeframe alignment...</span>
        </div>
      )}

      {data && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Base TF: <strong className="text-foreground">{data.baseTimeframe}</strong></span>
            <span>Refreshed: {new Date(data.fetchedAt).toLocaleTimeString()}</span>
          </div>

          <div className="space-y-2">
            {data.rows.map((row) => {
              const isBase = row.timeframe === data.baseTimeframe;
              return (
                <div
                  key={row.timeframe}
                  className={`rounded-xl border p-2.5 transition-colors ${
                    isBase
                      ? "bg-card border-foreground/30"
                      : "bg-card border-border hover:border-foreground/20"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-numeric text-sm font-bold text-foreground">{row.timeframe}</span>
                      <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {row.role}
                      </span>
                      {isBase && (
                        <span className="rounded-full border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getStateBadge(
                        row.state
                      )}`}
                    >
                      {row.state}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 border-t border-border py-1 text-[11px]">
                    <div>
                      <span className="block text-[10px] uppercase text-muted-foreground">Structure</span>
                      <span className="font-medium">{row.structure || "—"}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase text-muted-foreground">Momentum</span>
                      <span className="font-medium">{row.momentum || "—"}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase text-muted-foreground">Setup</span>
                      <span className="font-medium">{row.setup || "—"}</span>
                    </div>
                  </div>

                  {row.conflicts && row.conflicts.length > 0 && (
                    <div className="mt-1.5 flex items-start space-x-1 border-t border-border pt-1.5 text-[10px] text-warning">
                      <AlertTriangleIcon className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                      <span>{row.conflicts.join(", ")}</span>
                    </div>
                  )}

                  {row.notes && row.notes.length > 0 && (
                    <div className="mt-1 text-[10px] italic text-muted-foreground">
                      {row.notes.join(" • ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
